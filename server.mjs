#!/usr/bin/env node
// Nimion HQ: a crew of Claude Code agents. Each run is `claude -p`, so it uses your
// claude.ai subscription login and its limits, never an API key.
// Usage: node server.mjs [project-folder]
import http from 'node:http';
import { spawn, execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './world.js'; // shared pure helpers (globalThis.HQW): usage sums, repeat rules in words
import './md.js'; // globalThis.md: finds the file paths a reply mentions
const { sumUsage } = globalThis.HQW;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4321);
const HOME = path.resolve(process.env.HQ_HOME || HERE); // your data: crew.json, data.json, attachments/, worktrees/ (HQ_HOME: tests, or a second copy)
fs.mkdirSync(HOME, { recursive: true });
const WORKDIR = path.resolve(process.argv[2] || path.join(HOME, 'workspace'));
const DATA = path.join(HOME, 'data.json');
const MAX_UTIL = Number(process.env.HQ_MAX_UTIL || 0.9); // stop starting runs before the plan limit (and paid overage) is reached
const SCHED_UTIL = Number(process.env.HQ_SCHED_UTIL || MAX_UTIL - 0.15); // scheduled runs stop starting here, so you keep the rest of each window
const PERMS = process.env.HQ_PERMS || 'auto'; // Claude Code's auto mode: a safety check approves routine calls and blocks risky ones
const CREW_FILE = path.join(HOME, 'crew.json');
if (!fs.existsSync(CREW_FILE)) fs.copyFileSync(path.join(HERE, 'crew.example.json'), CREW_FILE); // first run: start from the sample crew
let CREW = JSON.parse(fs.readFileSync(CREW_FILE, 'utf8')); // edited live from the Crew panel
const FINISHED = ['done', 'failed', 'stopped'];
const LOOP_LIMIT = 8; // the same tool call this many times in a row means the run is stuck (from Munder Difflin)
const BOSS_ROUNDS = 3; // how many times the boss may review the reports and hand out more work
const ASK_TIMEOUT_MS = 30 * 60_000; // an unanswered tool approval is denied after this
const ATTACH_DIR = path.join(HOME, 'attachments'); // copies of attached files; shortcut: never cleaned up, delete it when you like
const MAX_ATTACH_MB = 50;
const MAX_ATTACHMENTS = 20;
const ASK_RULE = 'If you need a decision that only the human can make, stop and end your reply with a line that starts with "QUESTION:" followed by one bold sentence saying what you need. ' +
  'Then give 2 to 4 options as bullets, your recommendation first. Each option is a short answer the human can pick as it is, then " — " and what you will do with it. ' +
  'The human picks one with a click or writes their own answer. Keep it under 700 characters.';

const MEMORY_MAX = 8000;
// The boss's last reply in a job: the human reads this, so it carries the results, not just "done".
export const FINAL_REPORT = 'write the final report for the human: 1. **Outcome**: one or two sentences on whether the goal is met. ' +
  '2. **Who did what**: one bullet per nimion with what they did and their key result, quoting the important numbers, findings or text. ' +
  '3. **Files**: every file the crew made or changed, as a bullet with its full absolute path and a few words on what it holds. ' +
  '4. **Open**: anything not done, unverified, or waiting on the human (or "Nothing open."). Do not end with a ```json block.';
const HISTORY_TOOLS = ['mcp__nimionhq__history_search', 'mcp__nimionhq__history_get', 'mcp__nimionhq__schedule_list', 'mcp__nimionhq__schedule_preview']; // read-only, so never asked about
const bossRules = (memory, schedules = []) => `\n\n## Your memory\nStanding guidance from the human. Follow it on every job, and put the parts that matter into your task contracts:\n${memory || '(empty)'}\n\n` +
  'When the human gives guidance meant to last (how to work, preferences, rules, methods), save it: end your reply with a ```memory block that holds the whole updated memory as short bullets. ' +
  'Before saving, compare the new guidance with every line already there, and merge duplicates. ' +
  'If it contradicts a line and the human did not clearly say it replaces that line, do not save: ask with QUESTION: which should hold (the old line, the new one, or each in its own case), quoting both. ' +
  'Also ask first if you are not sure what the human means or whether it should last. Save only once it is clear, so memory never holds two lines that disagree. ' +
  'Keep job details, results and dates out of memory.\n\n## Answering without a plan\nIf a message needs no work from the crew (you can answer it yourself, it is about past jobs, ' +
  'or it is guidance to remember), answer it and end with an empty ```json [] block instead of a plan.\n\n## Past jobs\nEvery job is kept. When asked about earlier work, search it with mcp__nimionhq__history_search ' +
  'and read a job with mcp__nimionhq__history_get. Report what you find instead of copying it into memory.' +
  `\n\n## Schedules\nYou can schedule jobs to run later or on a repeat. It is now ${fmtTime(Date.now())} (${localTz()}). The current schedules:\n${scheduleNote(schedules)}\n\n` +
  'When the human asks for a job at a later time or on a repeat, end your reply with a ```schedule block holding a JSON array of changes, then an empty ```json [] block ' +
  '(or a plan, if there is also work for now). To add one: {"op": "add", "name": "<short name>", "nimion": "<a crew name, or yourself>", "prompt": "<the whole job, as a task contract>", ' +
  '"cron": "<minute hour day-of-month month day-of-week>"} for a repeat in the human\'s local time (for example "0 9 * * 1-5" is weekdays at 09:00), or "at": "YYYY-MM-DDTHH:MM" (local) or "in": "2h" instead of cron for one run. ' +
  'Other changes: {"op": "edit", "id": 3, ...only the fields to change}, {"op": "pause", "id": 3}, {"op": "resume", "id": 3}, {"op": "delete", "id": 3}, {"op": "run", "id": 3} (one run now). ' +
  'Give a schedule to yourself when the job needs planning and several nimions, or to one nimion when one can do it. Runs must be at least 15 minutes apart. ' +
  'Before you add one, compare it with every schedule above. If one has the same nimion and almost the same job or name, edit it instead of adding another. ' +
  'If the new one clashes with one (same nimion and time, or the opposite instruction), do not write a block: ask with QUESTION: which should hold, quoting both. ' +
  'Also ask first if the time, the repeat or who should do it is not clear (for example "in the morning" or "regularly"), with 2 to 4 concrete times as options. ' +
  'Check a new rule with mcp__nimionhq__schedule_preview, read a schedule\'s runs with mcp__nimionhq__schedule_list, and say in words when the first run will be. Keep schedules out of memory.';

// ---------- pure logic (tested in test.mjs) ----------

const frac = u => (u > 1 ? u / 100 : u || 0); // the CLI reports 0..1; tolerate percentages

export function breakerTripped(l, now = Date.now(), max = MAX_UTIL) {
  if (!l) return null;
  const live = ts => !ts || ts * 1000 > now; // a limit that has already reset no longer blocks
  if ((l.isUsingOverage || l.status === 'rejected') && live(l.resetsAt))
    return l.isUsingOverage ? 'Plan limit hit: more work would use paid extra usage' : 'Plan limit reached';
  for (const [k, w] of Object.entries(l.unifiedWindows || {}))
    if (frac(w.utilization) >= max && live(w.resetsAt)) return `${k.replace('_', '-')} usage at ${Math.round(frac(w.utilization) * 100)}%`;
  return null;
}

const deps = t => [].concat(t.after ?? []); // ids this task waits for (older boards stored one id)

// One run per nimion at a time; a task with `after` waits until those tasks are done.
export function pickRunnable(tasks) {
  const busy = new Set(tasks.filter(t => t.status === 'working').map(t => t.nimion));
  const out = [];
  for (const t of tasks) {
    if (t.status !== 'queued' || busy.has(t.nimion)) continue;
    if (deps(t).some(id => { const d = tasks.find(x => x.id === id); return d && d.status !== 'done'; })) continue;
    busy.add(t.nimion);
    out.push(t);
  }
  return out;
}

// The boss ends its reply with ```json [{"nimion": "...", "task": "...", "after": [0]}] ```.
// "after" lists earlier steps to wait for; left out, a step waits for the one before it.
// Returned `after` values are indexes into the returned plan.
export function parsePlan(text = '', names) {
  for (const b of [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].reverse()) {
    let arr;
    try { arr = JSON.parse(b[1]); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    const kept = new Map(); // index in the boss's list -> index in the returned plan
    const plan = [];
    arr.forEach((x, i) => {
      const name = names.find(n => n.toLowerCase() === String(x?.nimion).toLowerCase());
      if (!name || typeof x.task !== 'string' || !x.task.trim()) return;
      const after = Array.isArray(x.after) ? [...new Set(x.after.filter(j => j < i && kept.has(j)).map(j => kept.get(j)))] : plan.length ? [plan.length - 1] : [];
      kept.set(i, plan.length);
      plan.push({ nimion: name, task: x.task.trim(), after });
    });
    return plan;
  }
  return [];
}

// A nimion that needs the human ends its reply with a line starting "QUESTION:" (see ASK_RULE).
export function parseQuestion(text = '') {
  const m = text.match(/(?:^|\n)[*_\s]*QUESTION:[*_]*\s*([\s\S]+)$/);
  return m ? m[1].replace(/```(?:json|memory)[\s\S]*?```/g, '').trim().slice(0, 2000) : null; // the boss's plan or memory block is not part of the ask
}

// The boss saves its standing guidance by ending a reply with a ```memory block that holds the whole updated memory.
export function parseMemory(text = '') {
  const m = [...String(text ?? '').matchAll(/```memory[ \t]*\n([\s\S]*?)```/g)].at(-1);
  return m ? m[1].trim().slice(0, MEMORY_MAX) : null;
}

// Past jobs, newest first. Every word of q must appear in the job's title, prompt, result or log.
export function searchJobs(tasks, { q = '', nimion = '', limit = 25 } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const t of [...tasks].reverse()) {
    if (nimion && t.nimion !== nimion) continue;
    const hay = [t.title, t.prompt, t.result, ...(t.log || []).map(l => l.t)].join('\n').toLowerCase();
    if (!words.every(w => hay.includes(w))) continue;
    const at = words.length ? hay.indexOf(words[0]) : -1;
    const snippet = at < 0 ? '' : hay.slice(Math.max(0, at - 80), at + 160).replace(/\s+/g, ' ');
    out.push({ id: t.id, nimion: t.nimion, status: t.status, title: t.title, created: t.created, parent: t.parent, archived: !!t.archived, snippet });
    if (out.length >= limit) break;
  }
  return out;
}

// Split a question into the ask and its bullet options, which the page shows as one-click answers.
export function splitQuestion(q = '') {
  const opt = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/, lines = q.split('\n');
  const options = lines.map(l => l.match(opt)?.[1].trim()).filter(Boolean).slice(0, 6);
  const ask = lines.filter(l => !opt.test(l)).join('\n').trim();
  return options.length >= 2 && ask ? { question: ask, options } : { question: q, options: [] };
}

// The note that tells a nimion what the human attached.
export function attachNote(list = []) {
  if (!list.length) return '';
  const size = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
  return '\n\nThe human attached these. Read them with your tools (Read handles images and PDFs). They are read-only: changing them needs the human\'s approval.\n' +
    list.map(a => `- ${a.path} (${a.kind === 'dir' ? 'folder' : size(a.size)})`).join('\n');
}

// What every nimion is told about the folders linked as context for the whole crew.
export function contextNote(list = []) {
  if (!list.length) return '';
  return '\n\nLinked context: folders the human linked for the whole crew. Explore them with your tools (Read, ls, grep, find) ' +
    'whenever they could help. They are read-only: changing them needs the human\'s approval.\n' +
    list.map(c => `- ${c.path}${c.note ? ` — ${c.note}` : ''}`).join('\n');
}

// A crew member sent from the Crew panel, checked before it is saved to crew.json.
export function checkNimion(b = {}, existing, known) { // known: the skill names a run can load, when we have them
  const name = existing ? existing.name : String(b.name ?? '').trim(); // the name is the key tasks use, so it never changes
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,19}$/.test(name)) throw new Error('Name: 1–20 letters, digits, - or _, starting with a letter.');
  const title = String(b.title ?? '').trim(), role = String(b.role ?? '').trim();
  if (!title || title.length > 60) throw new Error('Title: 1–60 characters.');
  if (!role || role.length > 4000) throw new Error('Role: say what this nimion does (up to 4,000 characters).');
  const { eyes, prop, tone, style } = b.look ?? {};
  const ok = (re, v) => typeof v === 'string' && re.test(v); // a bare re.test(undefined) checks the string "undefined"
  const look = { eyes: eyes === 1 ? 1 : 2, prop: ok(/^[a-z]{1,20}$/, prop) ? prop : 'none', ...(ok(/^#[0-9a-f]{6}$/i, tone) && { tone }),
    ...(HQW.STYLES.some(([k]) => k === style) && { style }) }; // sprout, bobble or tuft; none set draws the first
  const model = String(b.model ?? '').trim();
  if (model && !/^[\w.[\]-]{1,60}$/.test(model)) throw new Error('Model: a model name such as sonnet, haiku or opus.');
  const allow = (Array.isArray(b.allow) ? b.allow : []).map(s => String(s).trim()).filter(Boolean);
  if (allow.length > 400 || allow.some(s => s.length > 200)) throw new Error('Allowed tools: up to 400 entries of up to 200 characters.'); // room for per-tool connector rules
  const skills = [...new Set((Array.isArray(b.skills) ? b.skills : []).map(s => String(s).trim()).filter(Boolean))];
  if (skills.length > 30 || skills.some(s => !/^[\w.:-]{1,100}$/.test(s))) throw new Error('Skills: up to 30 skill names, such as engineering:code-review.');
  const missing = known?.size ? skills.filter(s => !known.has(s) && !existing?.skills?.includes(s)) : []; // a skill it already had may stay after an uninstall
  if (missing.length) throw new Error(`Not installed, so a run can't load it: ${missing.join(', ')}.`);
  return { name, title, role, look, ...(model && { model }), ...(allow.length && { allow }), ...(skills.length && { skills }), ...(existing?.boss && { boss: true }) };
}

// A SKILL.md's front matter: its name and description (a plain, quoted or folded YAML value).
export function parseSkillMd(text = '') {
  const fm = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const lines = fm[1].split(/\r?\n/), get = k => {
    const i = lines.findIndex(l => l.startsWith(k + ':'));
    if (i < 0) return '';
    let v = lines[i].slice(k.length + 1).trim();
    if (/^[|>][-+]?$/.test(v) || !v) { const more = []; for (const l of lines.slice(i + 1)) { if (!/^\s/.test(l)) break; more.push(l.trim()); } v = more.join(' '); }
    return v.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
  };
  return { name: get('name'), description: get('description') };
}
// The first sentence of a description, for prompts and badges.
export const oneLine = (d = '') => { const s = String(d).replace(/\s+/g, ' ').trim(), m = s.match(/^.{20,}?[.!?](?=\s|$)/); return (m ? m[0] : s).slice(0, 180); };

// What a nimion is told about its skills.
export function skillNote(skills = [], about = {}) {
  if (!skills.length) return '';
  return '\n\n## Your skills\nThese Claude Code skills are yours. When a job fits one, load it with the Skill tool before you start, and follow it. Say in your report which skill you used.\n' +
    skills.map(s => `- ${s}${about[s] ? ` — ${about[s]}` : ''}`).join('\n');
}

// Jobs done and failed, average time and current load per nimion, from every job kept (cleared ones too).
export function crewStats(tasks, names, now = Date.now()) {
  const day0 = new Date(now).setHours(0, 0, 0, 0);
  return Object.fromEntries(names.map(n => {
    const mine = tasks.filter(t => t.nimion === n), done = mine.filter(t => t.status === 'done'), ms = done.map(t => t.ms).filter(Number.isFinite);
    return [n, { done: done.length, failed: mine.filter(t => t.status === 'failed').length, total: mine.length,
      avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null, load: mine.filter(t => ['queued', 'working', 'needs-you'].includes(t.status)).length,
      usage: { today: sumUsage(mine, day0), week: sumUsage(mine, now - 7 * 86400_000), all: sumUsage(mine) } }];
  }));
}
// What one run used, from its stream-json result: tokens, time and turns, and the notional API price when the CLI reports one.
export function runUsage(e, at = Date.now()) {
  const u = e.usage || {}, n = v => (Number.isFinite(v) && v >= 0 ? v : 0);
  return { at, in: n(u.input_tokens), out: n(u.output_tokens), cacheR: n(u.cache_read_input_tokens), cacheW: n(u.cache_creation_input_tokens),
    ms: n(e.duration_ms), turns: n(e.num_turns), ...(Number.isFinite(e.total_cost_usd) && { cost: e.total_cost_usd }) };
}
// Who used the current limit window: per nimion, every run since `since` (cleared jobs included), most tokens first.
export function windowUsage(tasks, since) {
  const by = new Map();
  for (const t of tasks) for (const r of t.runs || []) if (r.at >= since) by.set(t.nimion, (by.get(t.nimion) || []).concat({ runs: [r] }));
  return [...by].map(([nimion, ts]) => ({ nimion, ...sumUsage(ts) })).sort((a, b) => b.tokens - a.tokens);
}

// A file named in a reply, as an absolute path inside one of `roots`, or null. Relative names are tried against
// each base in order (the job's folder first). `real` returns the real path of an existing file (symlinks followed) or null.
export function resolveFile(raw, bases, roots, real, home = os.homedir()) {
  let p = String(raw || '').trim().replace(/^file:\/\//, '').replace(/:\d+(:\d+)?$/, ''); // drop file:// and a :line suffix
  try { p = decodeURI(p); } catch { /* keep it as written */ }
  if (!p || p.length > 1000 || p.includes('\0')) return null;
  if (p === '~' || p.startsWith('~/')) p = path.join(home, p.slice(2));
  for (const c of path.isAbsolute(p) ? [path.normalize(p)] : bases.filter(Boolean).map(b => path.resolve(b, p))) {
    const r = real(c);
    if (r && inside(r, roots)) return r;
  }
  return null;
}
export const inside = (p, roots) => roots.some(r => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep));
// Deliverables: the files a job made. Only paths and metadata are kept on the task (t.files), never copies.
const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
export const toolFile = b => (FILE_TOOLS.includes(b?.name) ? String(b.input?.file_path || b.input?.notebook_path || '') || null : null);
export const mentionedPaths = text => [...new Set([...globalThis.md(String(text || '')).matchAll(/data-path="([^"]+)"/g)]
  .map(m => m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')).filter(p => !p.endsWith('/')))]; // files, not folders
const KIND_RANK = { wrote: 3, edited: 2, mentioned: 1 };
export function addFile(files = [], p, kind, at = Date.now()) { // one entry per path; the strongest kind wins, the time is the latest
  const old = files.find(f => f.path === p);
  if (!old) return files.concat({ path: p, kind, at });
  return files.map(f => (f === old ? { path: p, kind: KIND_RANK[kind] > KIND_RANK[f.kind] ? kind : f.kind, at: Math.max(f.at, at) } : f));
}
// The shelf: one row per file. The job that wrote it comes first (then edited, then named); `by` lists every job that touched it.
export function deliverables(hits, exists = () => true) {
  const rows = new Map();
  for (const h of hits) (rows.get(h.path) || rows.set(h.path, []).get(h.path)).push(h);
  return [...rows].map(([p, by]) => {
    by.sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind] || a.at - b.at);
    return { ...by[0], name: path.basename(p), ext: path.extname(p).slice(1).toLowerCase(), at: Math.max(...by.map(h => h.at)), exists: exists(p), by };
  }).sort((a, b) => b.at - a.at);
}
export const OPEN_WITH = { finder: f => ['open', ['-R', f]], vscode: f => ['open', ['-a', 'Visual Studio Code', f]], browser: f => ['open', [f]], default: f => ['open', [f]] };

export const GAMES = ['catch', 'stack', 'match', 'toss', 'pinball', 'aliens', 'bricks', 'paddle', 'racer', 'tanks'];
// Arcade high scores: the best 5 per game, higher is better, earlier wins a tie.
export function addScore(games = {}, game, score, at = Date.now()) {
  if (!GAMES.includes(game)) throw new Error('No such game.');
  if (!Number.isInteger(score) || score < 0 || score > 1e6) throw new Error('A score is a whole number from 0 to 1,000,000.');
  return { ...games, [game]: [...(games[game] || []), { score, at }].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, 5) };
}

// ---------- schedules (pure; the timer that uses them is under "schedules: the timer") ----------
// A schedule is a saved job with a rule: once at a time, or a 5-field cron rule in the Mac's local time zone.
export const SCHED = { minGapMs: 15 * 60_000, perHour: 12, max: 50, failPause: 3, lateMs: 6 * 3600_000, keep: 20, promptMax: 20_000 };
const OPEN = ['queued', 'working', 'needs-you'];

// "0 9 * * 1-5": minute, hour, day of month, month, day of week (0 or 7 is Sunday). *, lists, ranges and /steps.
// shortcut: no month or day names (jan, mon) and no @daily; add them if people type them.
export function parseCron(expr) {
  const parts = String(expr ?? '').trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A repeat rule has 5 parts: minute hour day-of-month month day-of-week, such as 0 9 * * 1-5.');
  const span = [[0, 59, 'minute'], [0, 23, 'hour'], [1, 31, 'day of month'], [1, 12, 'month'], [0, 7, 'day of week']];
  const [min, hour, dom, mon, dow] = parts.map((p, i) => {
    const [lo, hi, what] = span[i], out = new Set();
    for (const item of p.split(',')) {
      const m = item.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
      if (!m) throw new Error(`Bad ${what} in the repeat rule: "${item}".`);
      const a = m[1] === '*' ? lo : Number(m[2]), b = m[1] === '*' ? hi : m[3] !== undefined ? Number(m[3]) : m[4] ? hi : a, step = m[4] ? Number(m[4]) : 1;
      if (a < lo || b > hi || a > b || step < 1) throw new Error(`Bad ${what} in the repeat rule: "${item}" (${lo} to ${hi}).`);
      for (let v = a; v <= b; v += step) out.add(i === 4 && v === 7 ? 0 : v);
    }
    return out;
  });
  return { min, hour, dom, mon, dow, dayAnd: parts[2].startsWith('*') || parts[4].startsWith('*') }; // cron: both days restricted means either may match
}
const dayOk = (c, dom, dow) => (c.dayAnd ? c.dom.has(dom) && c.dow.has(dow) : c.dom.has(dom) || c.dow.has(dow));
const wallOf = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()); // the local wall time as a number

// The first slot after `from` (ms), or null if the rule never fires in the next 2 years. Local time.
// DST: a slot the clock jumps over runs at the first minute after the jump; a slot in an hour that repeats runs once.
export function nextAfter(rule, from) {
  const c = typeof rule === 'string' ? parseCron(rule) : rule, floor = wallOf(new Date(from)), stop = from + 2 * 366 * 86400_000;
  let t = Math.floor(from / 60_000) * 60_000 + 60_000;
  while (t < stop) {
    const d = new Date(t);
    if (!c.mon.has(d.getMonth() + 1)) { t = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); continue; }
    if (!dayOk(c, d.getDate(), d.getDay())) { t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); continue; }
    const p = new Date(t - 60_000), jump = p.getTimezoneOffset() - d.getTimezoneOffset(); // > 0: the clock went forward just before t
    for (let k = 1; k <= jump; k++) {
      const w = new Date(Date.UTC(p.getFullYear(), p.getMonth(), p.getDate(), p.getHours(), p.getMinutes() + k)); // a wall time that never happened
      if (w.getTime() > floor && c.min.has(w.getUTCMinutes()) && c.hour.has(w.getUTCHours()) && c.mon.has(w.getUTCMonth() + 1) && dayOk(c, w.getUTCDate(), w.getUTCDay())) return t;
    }
    if (!c.hour.has(d.getHours())) { t += (60 - d.getMinutes()) * 60_000; continue; }
    if (c.min.has(d.getMinutes()) && wallOf(d) > floor) return t;
    t += 60_000;
  }
  return null;
}

// "2h", "90m", "1h30m", "in 20 minutes", "1 day" -> ms.
export function parseIn(v) {
  const s = String(v ?? '').toLowerCase().trim().replace(/^in\s+/, ''), unit = { d: 86400_000, h: 3600_000, m: 60_000 };
  const parts = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)(?![a-z])\s*(?:and\s*)?/g)];
  if (!parts.length || parts.map(p => p[0]).join('') !== s) throw new Error(`"${v}" is not a length of time. Use something like 20m, 2h or 1d.`);
  const ms = parts.reduce((n, p) => n + Number(p[1]) * unit[p[2][0]], 0);
  if (ms < 60_000) throw new Error('Give at least 1 minute.');
  return Math.round(ms);
}
// A time: epoch ms, "2026-11-15T17:00" (local) or an ISO string with an offset.
export function toTime(v) {
  const n = typeof v === 'number' ? v : Date.parse(String(v ?? '').trim());
  if (!Number.isFinite(n)) throw new Error(`"${v}" is not a time. Use YYYY-MM-DDTHH:MM.`);
  return n;
}

// A schedule sent from the popup, the API or the boss's block, checked before it is saved. Returns the fields to save.
export function checkSchedule(b = {}, existing, { names = [], now = Date.now() } = {}) {
  const given = k => b[k] !== undefined && b[k] !== null && b[k] !== '', sent = k => Object.prototype.hasOwnProperty.call(b, k);
  const nimion = given('nimion') ? names.find(n => n.toLowerCase() === String(b.nimion).trim().toLowerCase()) : existing?.nimion;
  if (!nimion) throw new Error(given('nimion') ? `"${b.nimion}" is not in the crew.` : 'Say which nimion does the job.');
  const prompt = given('prompt') ? String(b.prompt).trim() : existing?.prompt;
  if (!prompt || prompt.length > SCHED.promptMax) throw new Error(`Say what the job is (up to ${SCHED.promptMax.toLocaleString('en')} characters).`);
  const name = String(given('name') ? b.name : existing?.name || prompt).replace(/\s+/g, ' ').trim().slice(0, 60);
  const kinds = ['cron', 'at', 'in', 'once'].filter(given), when = {};
  if (kinds.length > 1) throw new Error('Give only one of cron, at or in.');
  if (kinds[0] === 'cron') {
    const cron = String(b.cron).trim().replace(/\s+/g, ' '), c = parseCron(cron);
    let a = nextAfter(c, now);
    if (!a) throw new Error('That repeat rule never runs.');
    for (let i = 0; i < 50; i++) { // runaway guard: no two of the next 50 slots closer than 15 minutes
      const n = nextAfter(c, a);
      if (!n) break;
      if (n - a < SCHED.minGapMs) throw new Error('Runs must be at least 15 minutes apart.');
      a = n;
    }
    Object.assign(when, { cron, once: null });
  } else if (kinds[0]) {
    const at = kinds[0] === 'in' ? now + parseIn(b.in) : toTime(b[kinds[0]]);
    if (at < now - 60_000) throw new Error('That time has passed.');
    if (at > now + 366 * 86400_000) throw new Error('Pick a time within a year.');
    Object.assign(when, { once: Math.max(at, now), cron: null });
  } else if (existing) Object.assign(when, { cron: existing.cron ?? null, once: existing.once ?? null });
  else throw new Error('Say when: cron (a repeat rule), at (a time) or in (such as 2h).');
  const pick = (k, ok) => { const v = given(k) ? b[k] : existing?.[k] ?? ok[0]; if (!ok.includes(v)) throw new Error(`${k} is one of: ${ok.join(', ')}.`); return v; };
  const maxRuns = sent('maxRuns') ? (given('maxRuns') ? Number(b.maxRuns) : null) : existing?.maxRuns ?? null;
  if (maxRuns !== null && !(Number.isInteger(maxRuns) && maxRuns >= 1 && maxRuns <= 10_000)) throw new Error('maxRuns is a whole number from 1 to 10,000.');
  const until = sent('until') ? (given('until') ? toTime(b.until) : null) : existing?.until ?? null;
  if (until !== null && until <= now) throw new Error('until must be in the future.');
  return { name, nimion, prompt, ...when, overlap: pick('overlap', ['skip', 'queue']), catchUp: pick('catchUp', ['latest', 'none']), atLimit: pick('atLimit', ['wait', 'skip']),
    carry: sent('carry') ? b.carry !== false : existing?.carry ?? true, maxRuns, until };
}

// The slot a schedule should act on now: the latest one that is due, and how many earlier ones were missed.
export function dueSlot(s, now) {
  if (s.paused || s.deleted || !s.nextAt || s.nextAt > now) return null;
  let slot = s.nextAt, missed = 0;
  if (s.cron) for (let n = nextAfter(s.cron, slot); n && n <= now && missed < 20_000; n = nextAfter(s.cron, slot)) { slot = n; missed++; }
  return { slot, missed };
}

// A schedule's runs that are not finished. A boss run is open while any of its crew's steps is.
export const openRuns = (s, tasks) => tasks.filter(t => t.schedule === s.id && (OPEN.includes(t.status) || tasks.some(k => k.parent === t.id && OPEN.includes(k.status))));

// What to do with a due slot: fire it, skip it (and say why), or pause the schedule.
export function slotDecision(s, slot, { now, tasks, names, firedLastHour = 0, limited = null }) {
  if (!names.includes(s.nimion)) return { act: 'pause', why: `${s.nimion} is not in the crew.` };
  const late = now - slot;
  if (late > SCHED.lateMs) return { act: 'skip', status: 'missed', why: 'Missed: more than 6 hours late (Nimion HQ was off or the Mac was asleep).' };
  if (s.catchUp === 'none' && late > 120_000) return { act: 'skip', status: 'missed', why: 'Missed while Nimion HQ was off or the Mac was asleep (missed runs are skipped).' };
  if (openRuns(s, tasks).length >= (s.overlap === 'queue' ? 2 : 1)) return { act: 'skip', status: 'skipped', why: 'Skipped: the last run has not finished.' };
  if (firedLastHour >= SCHED.perHour) return { act: 'skip', status: 'skipped', why: `Skipped: ${SCHED.perHour} scheduled runs already started in the last hour.` };
  if (limited && s.atLimit === 'skip') return { act: 'skip', status: 'skipped', why: `Skipped at the plan limit: ${limited}.` };
  return { act: 'fire' };
}

// The boss changes schedules by ending a reply with a ```schedule block: a JSON array of {op, ...} changes.
export function parseSchedule(text = '') {
  const m = [...String(text ?? '').matchAll(/```schedule[ \t]*\n([\s\S]*?)```/g)].at(-1);
  if (!m) return null;
  let v;
  try { v = JSON.parse(m[1]); } catch { return { ops: [], error: 'The ```schedule block is not valid JSON.' }; }
  return { ops: (Array.isArray(v) ? v : [v]).filter(x => x && typeof x === 'object' && !Array.isArray(x)).slice(0, 20) };
}

export const fmtTime = ms => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const whenText = s => (s.cron ? `${globalThis.HQW.describeCron(s.cron).replace(/^\w/, c => c.toLowerCase())} (cron ${s.cron})` : s.once ? `once at ${fmtTime(s.once)}` : 'once');
// One line per schedule, for the boss's prompt and the chat.
export function scheduleLine(s) {
  return `#${s.id} "${s.name}" for ${s.nimion}, ${whenText(s)}, ${s.paused ? `paused${s.pausedWhy ? ` (${s.pausedWhy})` : ''}` : s.cron ? (s.nextAt ? `next ${fmtTime(s.nextAt)}` : 'no next run') : 'waiting'}`;
}
export const scheduleNote = (list = []) => list.filter(s => !s.deleted).map(s => `- ${scheduleLine(s)}. Job: ${s.prompt.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n') || '(none)';

// The start of a scheduled run's prompt: which run this is, and what the last run reported.
export function runHeader(s, { slot, n, missed = 0, last, boss = false }) {
  return `Scheduled run ${n} of "${s.name}" (${whenText(s)}), due ${fmtTime(slot)}.` +
    (missed ? ` ${missed} earlier run(s) were missed while Nimion HQ was off or the Mac was asleep, so this is the latest one.` : '') +
    (s.carry !== false && last?.result ? `\n\nThe last run (#${last.id}, ${fmtTime(last.created)}) reported:\n${last.result.slice(0, 1500)}` : '') +
    (boss ? '' : '\n\nEnd with a short report: the outcome in one or two sentences, then every file you made or changed, with its full path.') +
    `\n\n---\n${s.prompt}`;
}

// A file name that is safe to write inside the attachments folder.
export function safeName(name = '') {
  const n = path.basename(String(name)).replace(/[^\w.\-+() ]+/g, '_').slice(0, 120);
  return !n || n === '.' || n === '..' ? 'file' : n;
}

// Drop a parent Claude session's markers: CLAUDE_CODE_CHILD_SESSION turns off transcript
// saving and breaks --resume (found in Munder Difflin's ptyEnv.ts). Drop API keys so the
// claude.ai login is used.
const KEEP = new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']);
export function cleanEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) =>
    !(/^CLAUDE/.test(k) && !KEEP.has(k)) && k !== 'ANTHROPIC_API_KEY' && k !== 'ANTHROPIC_AUTH_TOKEN'));
}

// ---------- state ----------

let state = { nextId: 1, tasks: [], limits: null, context: [], schedules: [], nextScheduleId: 1 };
let isGit = false;
const procs = new Map(); // task id -> child process
const loops = new Map(); // task id -> { key, n } for repeated-call detection
const approvals = new Map(); // approval id -> pending tool permission request
let nextApproval = 1;
const clients = new Set();
const feed = []; // the last 500 log lines from every task, for the live log
const feedClients = new Set();

function load() {
  try { state = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return; }
  state.context ||= [];
  state.schedules ||= [];
  state.nextScheduleId ||= 1;
  for (const t of state.tasks) {
    if (t.status === 'needs-you' && !t.options) Object.assign(t, splitQuestion(t.question)); // questions from before options existed
    if (t.status === 'working' && !sendQueued(t)) {
      // Pick the run back up, so a restart doesn't fail it and every step that waits on it.
      if (t.sessionId) requeue(t, 'Nimion HQ restarted while you were working. Carry on with your task from where you stopped.', 'Interrupted by a restart, so it carries on where it stopped.');
      else { t.status = 'queued'; log(t, 'sys', 'Interrupted by a restart before it began, so it starts again.'); }
    }
  }
}

// Write the whole file to a tmp file, then rename it over data.json: a crash never leaves half a file.
function saveData() {
  fs.writeFileSync(DATA + '.tmp', JSON.stringify(state));
  fs.renameSync(DATA + '.tmp', DATA);
}
let flush;
function changed() {
  if (flush) return;
  flush = setTimeout(() => {
    flush = null;
    saveData();
    const msg = `data: ${JSON.stringify(summary())}\n\n`;
    for (const c of clients) c.write(msg);
  }, 150);
}

// Runs must bill your Claude plan, never an API key. `claude auth status` runs with the same clean environment as a nimion.
export function authProblem(s) {
  if (!s) return 'Claude Code did not answer. Install it (see Setup), then press Check again.';
  if (!s.loggedIn) return 'Claude Code is not signed in. Run `claude auth login` in a terminal and pick your Claude account.';
  if (s.apiKeySource) return `Claude Code would use an API key (${s.apiKeySource}) instead of your plan. Remove it (often apiKeyHelper or env in ~/.claude/settings.json), then press Check again.`;
  if (!['claude.ai', 'oauth_token'].includes(s.authMethod)) return `Claude Code is signed in with ${s.authMethod}, not a Claude plan. Run \`claude auth logout\`, then \`claude auth login\` with your Claude account.`;
  return null;
}
const sh = (args, timeout = 20_000) => new Promise(resolve => execFile('claude', args, { cwd: WORKDIR, env: cleanEnv(process.env), timeout }, (err, out) => resolve(err && !out ? null : String(out))));
let setup = { problem: 'Checking your Claude sign-in…' };
async function checkSetup() {
  const [ver, st] = await Promise.all([sh(['--version']), sh(['auth', 'status'])]);
  let s = null;
  try { s = JSON.parse(st); } catch {}
  setup = { version: ver?.trim().split(' ')[0], plan: s?.subscriptionType, authMethod: s?.authMethod,
    problem: process.env.HQ_AUTH === 'any' ? null : ver ? authProblem(s) : 'Claude Code is not installed, or `claude` is not on the PATH of this server.' };
  tick();
}
// The MCP servers and connectors a nimion gets: the same as your own Claude Code in this folder. Names and status only (URLs can hold tokens).
export function parseMcpList(out) {
  return String(out || '').split('\n').map(l => l.match(/^(.+?): .* - ([✔✘!])\s*(.*)$/)).filter(Boolean)
    .map(([, name, mark, status]) => ({ name, ok: mark === '✔', status: status.split(/ [—-] /)[0].slice(0, 60) }));
}

// ---------- skills ----------
// Descriptions come from SKILL.md files on disk: your skills, the project's, and your plugins' (named plugin:skill).
// Which skills a run can really load comes from the CLI's init event, cached from every run (or a probe).
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
let diskSkills = null, diskAt = 0, probing = null;
function skillsOnDisk() {
  if (diskSkills && Date.now() - diskAt < 60_000) return diskSkills;
  const out = new Map();
  const scan = (dir, prefix, source) => {
    let subs = [];
    try { subs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() || d.isSymbolicLink()); } catch { return; }
    for (const d of subs) {
      let fm = null;
      try { fm = parseSkillMd(fs.readFileSync(path.join(dir, d.name, 'SKILL.md'), 'utf8').slice(0, 20_000)); } catch { continue; }
      const name = prefix + (fm?.name || d.name);
      if (!out.has(name)) out.set(name, { name, description: oneLine(fm?.description), source });
    }
  };
  scan(path.join(WORKDIR, '.claude', 'skills'), '', 'project');
  scan(path.join(CLAUDE_DIR, 'skills'), '', 'yours');
  try {
    const { plugins = {} } = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'), 'utf8'));
    for (const [key, list] of Object.entries(plugins)) for (const p of [].concat(list)) if (p?.installPath) scan(path.join(p.installPath, 'skills'), key.split('@')[0] + ':', 'plugin');
  } catch { /* no plugins */ }
  diskAt = Date.now();
  return (diskSkills = out);
}
// The list the NR office offers: what a run loads (when known), each with its one-line description.
function skillList() {
  const disk = skillsOnDisk(), seen = state.skillsSeen?.names;
  const names = seen ? seen : [...disk.keys()];
  return { checked: state.skillsSeen?.at || null, skills: names.map(n => ({ name: n, description: disk.get(n)?.description || '', source: disk.get(n)?.source || 'plugin' })) };
}
const skillAbout = names => Object.fromEntries(names.map(n => [n, skillsOnDisk().get(n)?.description || '']));
// A cheap probe: start a run, read its init event, and stop it before it does any work.
function probeSkills() {
  if (setup.problem) return Promise.reject(new Error(setup.problem));
  return probing ||= new Promise(resolve => {
    const child = spawn('claude', ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--max-turns', '1'], { cwd: WORKDIR, env: cleanEnv(process.env) });
    let buf = '';
    const done = () => { clearTimeout(timer); child.kill('SIGTERM'); probing = null; resolve(); };
    const timer = setTimeout(done, 30_000);
    child.stdout.on('data', d => {
      buf += d;
      for (const line of buf.split('\n').slice(0, -1)) { try { const e = JSON.parse(line); if (e.type === 'system' && e.subtype === 'init') { noteInit(e); done(); } } catch {} }
      buf = buf.slice(buf.lastIndexOf('\n') + 1);
    });
    child.on('error', done);
    child.on('close', done);
    child.stdin.end('Reply with OK.');
  });
}
function noteInit(e) {
  if (Array.isArray(e.skills)) { state.skillsSeen = { names: e.skills.filter(s => typeof s === 'string').slice(0, 1000), at: Date.now() }; changed(); }
}

function summary() {
  return {
    crew: CREW.map(({ role, ...c }) => c),
    workdir: WORKDIR,
    git: isGit,
    limits: state.limits,
    maxUtil: MAX_UTIL,
    breaker: breakerTripped(state.limits),
    setup,
    context: state.context,
    memory: state.memory || { text: '' },
    schedules: liveSchedules(),
    sched: { util: SCHED_UTIL, held: breakerTripped(state.limits, Date.now(), SCHED_UTIL), tz: localTz(), perHour: SCHED.perHour },
    games: state.games || {},
    deliverables: new Set(state.tasks.flatMap(t => (t.files || []).map(f => f.path))).size, // the shelf's count of files (cleared jobs included)
    window: (() => { const r = state.limits?.unifiedWindows?.five_hour?.resetsAt, since = r ? r * 1000 - 5 * 3600_000 : Date.now() - 5 * 3600_000;
      return { since, by: windowUsage(state.tasks, since) }; })(), // who used the 5-hour window
    approvals: [...approvals.values()].filter(a => a.status === 'pending'),
    tasks: state.tasks.filter(t => !t.archived).map(({ log: l, prompt, result, ...t }) => ({ ...t, last: l.at(-1) })), // full task via GET /api/tasks/:id; cleared jobs via /api/history
  };
}

// Every log line goes to its task, to the live log in the browser, and to stdout (the service log file).
function log(t, k, text, extra) {
  const e = { k, t: String(text).slice(0, 8000), at: Date.now(), ...extra }; // extra: { sched: id } puts the schedule's buttons on the line
  t.log.push(e);
  if (t.log.length > 500) t.log.splice(0, t.log.length - 500);
  const line = { ...e, task: t.id, nimion: t.nimion };
  feed.push(line);
  if (feed.length > 500) feed.shift();
  const msg = `data: ${JSON.stringify(line)}\n\n`;
  for (const c of feedClients) c.write(msg);
  console.log(`${new Date(e.at).toISOString()} #${t.id} ${t.nimion} ${k}: ${e.t.replace(/\s+/g, ' ').slice(0, 300)}`);
}

function saveCrew() {
  fs.writeFileSync(CREW_FILE + '.tmp', JSON.stringify(CREW, null, 2) + '\n');
  fs.renameSync(CREW_FILE + '.tmp', CREW_FILE); // atomic, so a crash never leaves half a file
}

const clip = list => (list?.length ? `\n📎 ${list.map(a => a.name).join(', ')}` : '');

function addTask(prompt, nimion, extra = {}) {
  const t = { id: state.nextId++, title: prompt.replace(/\s+/g, ' ').slice(0, 90), prompt, nimion, status: 'queued', log: [], created: Date.now(), ...extra };
  log(t, extra.parent || extra.schedule ? 'sys' : 'you', extra.parent ? `From boss task #${extra.parent}: ${prompt}` : `${extra.schedule ? '⏰ ' : ''}${prompt}${clip(extra.attach)}`);
  state.tasks.push(t);
  return t;
}

// Resume a finished task's session with a new message from the server (not from the human).
function requeue(t, prompt, note) {
  Object.assign(t, { prompt, resume: !!t.sessionId, status: 'queued', after: null, archived: undefined });
  log(t, 'sys', note);
}

// A human reply resumes the session. A resumed session hears only about the new attachments; a fresh run lists them all.
function applyReply(t, prompt, more) {
  Object.assign(t, { prompt: t.sessionId ? prompt + attachNote(more) : prompt, attach: [...(t.attach || []), ...more], resume: !!t.sessionId, status: 'queued', after: null, question: undefined, options: undefined, archived: undefined }); // a reply brings a cleared job back
}

// A reply sent while the task was running waits in t.queuedReply until the run ends.
function sendQueued(t) {
  if (!t.queuedReply) return false;
  const { prompt, more } = t.queuedReply;
  delete t.queuedReply;
  applyReply(t, prompt, more);
  log(t, 'sys', 'The run ended, so your reply is sent now.');
  return true;
}

// ---------- running nimions ----------

function buildPrompt(t, m) {
  if (t.resume) return t.prompt;
  if (m.boss) {
    // The live roster, rebuilt on every plan, so nimions added in the Crew panel are used with no code change.
    const crew = CREW.filter(c => !c.boss).map(c => {
      const busy = state.tasks.filter(x => x.nimion === c.name && ['queued', 'working', 'needs-you'].includes(x.status)).length;
      const about = skillAbout(c.skills || []), sk = (c.skills || []).map(s => `${s}${about[s] ? ` (${about[s]})` : ''}`).join('; ');
      return `- ${c.name}: ${c.title}. ${c.role.split(/(?<=[.!?])\s/)[0]}${sk ? ` Skills: ${sk}.` : ''}${busy ? ` (already has ${busy} task(s))` : ''}`;
    }).join('\n');
    return `Goal from the human:\n${t.prompt}${attachNote(t.attach)}\n\nYour crew:\n${crew}\n\n` +
      'The crew sees the same attachments and linked context. Look at the project if you need to, but do not change any files yourself. ' +
      'Give each step to the nimion whose title, role and skills fit it best. Weigh their Claude Code skills as well as their persona: when a step fits a skill, ' +
      'give it to the nimion that has that skill and name the skill in the TOOLS part of the contract (for example "TOOLS: load the engineering:code-review skill with the Skill tool"). ' +
      'One nimion can take several steps, and nimions you do not need can sit out. ' +
      'Reply with a short plan, then end with a ```json code block holding an array of steps like ' +
      '[{"nimion": "<crew name>", "task": "<instruction>", "after": [<indexes of earlier steps it waits for>]}]. ' +
      'Leave out "after" to run a step after the one before it. Give "after" as [] or as a list of earlier indexes to run steps at the same time on ' +
      'different nimions, but only when they will not edit the same files, because the whole plan shares one folder. ' +
      'Write each task as a 4-part contract: OBJECTIVE (the goal), OUTPUT (what to deliver), TOOLS (what to use, and what to read first), ' +
      'BOUNDARIES (scope and the definition of done). Point to files by path instead of pasting their content. Each step sees the reports ' +
      'of the steps that finished before it. When they are all finished, you get their reports to check.';
  }
  const before = state.tasks.filter(s => t.parent && s.parent === t.parent && s.id < t.id && s.result);
  const context = before.map(s => `### ${s.nimion} (task #${s.id}) reported:\n${s.result.slice(0, 2000)}`).join('\n\n');
  const task = t.prompt + attachNote(t.attach);
  return context ? `Earlier steps by your crewmates:\n\n${context}\n\n---\nYour task:\n${task}` : task;
}

// Each top-level task gets its own git worktree and branch, so nimions working at the same
// time never edit the same files. Boss subtasks share their boss task's worktree. Worktrees
// are never deleted here, so no work is lost; merge the branch when you are happy.
function workspaceFor(t) {
  const parent = t.parent && state.tasks.find(p => p.id === t.parent);
  if (parent?.cwd) return parent.cwd;
  if (!isGit) return WORKDIR;
  const s = t.schedule && state.schedules.find(x => x.id === t.schedule); // every run of a schedule shares one worktree, so they don't pile up
  const slug = (s ? s.name : t.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const branch = s ? `nimion/schedule-${s.id}-${slug}` : `nimion/${t.id}-${slug}`;
  const dir = path.join(HOME, 'worktrees', s ? `s${s.id}` : String(t.id));
  if (s?.branch && fs.existsSync(dir)) {
    t.branch = s.branch;
    log(t, 'sys', `Working in this schedule's worktree, ${dir}, on branch ${s.branch}. Every run of the schedule uses it.`);
    return dir;
  }
  try {
    execFileSync('git', ['-C', WORKDIR, 'worktree', 'add', '-b', branch, dir, 'HEAD'], { stdio: 'pipe' });
    t.branch = branch;
    if (s) s.branch = branch;
    log(t, 'sys', `Working on branch ${branch} in its own git worktree: ${dir}\nNimions do not commit. To keep the work, commit it in that folder, then merge ${branch}.`);
    return dir;
  } catch (e) {
    log(t, 'err', `Could not make a worktree, so this task uses the shared folder: ${String(e.stderr || e.message).trim()}`);
    return WORKDIR;
  }
}

function run(t) {
  const m = CREW.find(c => c.name === t.nimion);
  if (!m) { t.status = 'failed'; log(t, 'err', `No crew member named ${t.nimion} in crew.json.`); return; }
  t.cwd ||= workspaceFor(t);
  const mcp = { mcpServers: { nimionhq: { command: process.execPath, args: [path.join(HERE, 'approve-mcp.mjs')], env: { HQ_URL: `http://127.0.0.1:${PORT}`, HQ_TASK: String(t.id) } } } };
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt', `${m.role}${skillNote(m.skills, skillAbout(m.skills || []))}\n\n${ASK_RULE}${contextNote(state.context)}${m.boss ? bossRules(state.memory?.text, state.schedules) : ''}`,
    '--permission-mode', PERMS, '--mcp-config', JSON.stringify(mcp), '--permission-prompt-tool', 'mcp__nimionhq__approve'];
  if (t.resume && t.sessionId) args.push('--resume', t.sessionId);
  const model = process.env.HQ_MODEL || m.model;
  if (model) args.push('--model', model);
  if (m.boss) args.push('--disallowedTools', 'Edit', 'Write', 'NotebookEdit', '--system-prompt-snapshot', 'off'); // off: a resumed boss sees today's memory
  // Attachments and linked context are readable without asking (Read, ls, grep and find all follow the rule).
  // Changing them is not pre-approved, so it asks you in the UI. In a rule, `//` starts an absolute path.
  const reads = [...(t.attach || []).map(a => (a.kind === 'dir' ? `${a.path}/**` : a.path)), ...state.context.map(c => `${c.path}/**`)].map(p => `Read(/${p})`);
  const allow = [...(m.allow || []), ...(m.skills || []).map(s => `Skill(${s})`), ...reads, ...HISTORY_TOOLS]; // pre-approved; everything else asks you in the UI
  if (allow.length) args.push('--allowedTools', ...allow);

  Object.assign(t, { status: 'working', started: Date.now(), isError: false, result: undefined, question: undefined, options: undefined });
  const child = spawn('claude', args, { cwd: t.cwd, env: { ...cleanEnv(process.env), MCP_TOOL_TIMEOUT: String(ASK_TIMEOUT_MS + 60_000) } });
  procs.set(t.id, child);
  child.stdin.end(buildPrompt(t, m)); // via stdin, so a prompt starting with "-" is never read as a flag

  let buf = '', err = '';
  child.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try { onEvent(t, JSON.parse(line)); } catch { /* not JSON: ignore */ }
    }
  });
  child.stderr.on('data', d => { err = (err + d).slice(-3000); });
  child.on('error', e => { log(t, 'err', `Could not start claude: ${e.message}`); });
  child.on('close', code => {
    procs.delete(t.id);
    loops.delete(t.id);
    denyPending(t.id, 'The run ended.');
    t.resume = false;
    if (t.status === 'working') {
      const ok = code === 0 && !t.isError;
      const question = ok && parseQuestion(t.result);
      t.status = question ? 'needs-you' : ok ? 'done' : 'failed';
      if (question) Object.assign(t, splitQuestion(question));
      if (t.status === 'failed' && err.trim()) log(t, 'err', err.trim());
    }
    t.ms = Date.now() - t.started;
    const mem = m.boss && ['done', 'needs-you'].includes(t.status) ? parseMemory(t.result) : null; // only the boss keeps memory
    if (typeof mem === 'string') {
      state.memory = { text: mem, at: Date.now(), by: `${t.nimion} (task #${t.id})`, prev: state.memory?.text };
      log(t, 'sys', 'Updated its memory. See 🧠 Boss memory.');
    }
    const schedErrs = m.boss && ['done', 'needs-you'].includes(t.status) ? applyScheduleBlock(t) : null;
    if (!sendQueued(t)) { // your reply comes before handing out the plan or waking the boss
      if (m.boss && t.status === 'done') {
        if (schedErrs && !t.schedFixTried && !parsePlan(t.result, CREW.filter(c => !c.boss).map(c => c.name)).length) {
          t.schedFixTried = true;
          requeue(t, `These schedule changes failed:\n${schedErrs.map(e => `- ${e}`).join('\n')}\nFix them with a new \`\`\`schedule block and an empty \`\`\`json [] block, or ask the human with QUESTION:.`,
            'Some schedule changes failed, so the boss is asked once to fix them.');
        } else delegate(t);
      }
      if (t.parent && FINISHED.includes(t.status)) wakeBoss(t.parent);
    }
    noteRun(t.schedule ? t : state.tasks.find(x => x.id === t.parent && x.schedule)); // a scheduled run, or a step of a scheduled boss run
    tick();
  });
  changed();
}

function onEvent(t, e) {
  if (e.session_id) t.sessionId = e.session_id;
  if (e.type === 'system' && e.subtype === 'init') noteInit(e);
  if (e.type === 'assistant') {
    for (const b of e.message?.content || []) {
      if (b.type === 'text' && b.text.trim()) log(t, 'say', b.text);
      if (b.type === 'tool_use') {
        log(t, 'tool', `${b.name}  ${brief(b.input)}`);
        const fp = toolFile(b); // the file may not exist yet: keep the path if it is inside the crew folder or data home; the shelf checks it later
        if (fp && path.isAbsolute(fp) && inside(path.resolve(fp), [WORKDIR, HOME])) t.files = addFile(t.files, path.resolve(fp), b.name === 'Write' ? 'wrote' : 'edited');
        const key = `${b.name}:${JSON.stringify(b.input)}`;
        const n = loops.get(t.id)?.key === key ? loops.get(t.id).n + 1 : 1;
        loops.set(t.id, { key, n });
        if (n >= LOOP_LIMIT) stop(t, `Stopped: it made the same ${b.name} call ${n} times in a row, so it looks stuck. Reply to steer it.`);
      }
    }
  } else if (e.type === 'rate_limit_event') {
    state.limits = e.rate_limit_info;
    if (state.limits?.isUsingOverage)
      for (const id of procs.keys()) stop(state.tasks.find(x => x.id === id), 'Stopped: the plan limit is reached and more work would use paid extra usage.');
  } else if (e.type === 'result') {
    t.result = e.result || '';
    t.isError = !!e.is_error;
    t.turns = e.num_turns;
    (t.runs ||= []).push(runUsage(e)); // what this run used; older jobs have no runs and show "not recorded"
    const roots = fileRoots(), bases = fileBases(t);
    for (const raw of mentionedPaths(t.result).slice(0, 100)) { const f = resolveFile(raw, bases, roots, realOrNull); if (f && fs.statSync(f).isFile()) t.files = addFile(t.files, f, 'mentioned'); }
  }
  changed();
}

function brief(input = {}) {
  const v = input.command || input.file_path || input.pattern || input.url || input.query || input.description || input.prompt || JSON.stringify(input);
  return String(v).replace(/\s+/g, ' ').slice(0, 140);
}

function delegate(t) {
  const plan = parsePlan(t.result, CREW.filter(c => !c.boss).map(c => c.name));
  if (!plan.length) {
    const noWork = /```json\s*\[\s*\]\s*```/.test(t.result) || parseMemory(t.result) !== null || parseSchedule(t.result) !== null; // answered, saved guidance, or changed schedules
    // From Paperclip: a planning run must end in a usable result, so nudge the boss once.
    if (!noWork && !t.round && !t.fixTried) {
      t.fixTried = true;
      requeue(t, 'Your reply had no ```json task list. Reply again with only the ```json block, or with an empty ```json [] block if the crew has no work to do.', 'No task list in the reply, so the boss is asked once more.');
    }
    return; // in a review round, a reply without json is the final summary
  }
  if ((t.round || 0) >= BOSS_ROUNDS) return log(t, 'sys', `Reached ${BOSS_ROUNDS} review rounds, so no more work was handed out.`);
  const ids = [];
  for (const p of plan) ids.push(addTask(p.task, p.nimion, { parent: t.id, after: p.after.map(i => ids[i]), round: t.round || 0, attach: t.attach }).id);
  const parallel = plan.some((p, i) => i > 0 && !p.after.includes(i - 1));
  log(t, 'sys', `Handed out ${plan.length} task(s)${parallel ? ', some at the same time' : ''}: ${plan.map(p => p.nimion).join(', ')}`);
}

// From Paperclip: results flow up. When every step of the current round has finished,
// wake the boss with the reports so it can check them and hand out more work if needed.
function wakeBoss(id) {
  const boss = state.tasks.find(x => x.id === id);
  if (!boss || boss.status !== 'done') return;
  const round = boss.round || 0;
  const kids = state.tasks.filter(x => x.parent === id && (x.round || 0) === round);
  if (!kids.length || !kids.every(k => FINISHED.includes(k.status))) return;
  const stopped = kids.filter(k => k.status === 'stopped');
  boss.round = round + 1;
  const reports = kids.map(k => `### ${k.nimion} (task #${k.id}, ${k.status === 'stopped' ? 'stopped by the human' : k.status})\n${(k.result || '(no report)').slice(0, 4000)}`).join('\n\n');
  const last = boss.round >= BOSS_ROUNDS || stopped.length > 0; // a step the human stopped is not redone: report instead
  requeue(boss, `Your crew finished the steps. Their reports:\n\n${reports}\n\nCheck the reports against the goal. ` +
    (stopped.length ? `The human stopped ${stopped.map(k => `#${k.id}`).join(', ')}, so do not hand that work out again. ` : '') +
    (last ? `This is the final review: do not hand out more work. Now ${FINAL_REPORT}`
      : `If more work is needed, reply with a new \`\`\`json task list as before. Otherwise reply with no json and ${FINAL_REPORT}`),
  `All steps finished, so the boss is reviewing the reports (round ${boss.round} of ${BOSS_ROUNDS}).`);
}

function denyPending(taskId, message) {
  for (const a of approvals.values()) if (a.taskId === taskId && a.status === 'pending') Object.assign(a, { status: 'deny', message });
}

function stop(t, why = 'Stopped by you.') {
  if (!t || FINISHED.includes(t.status)) return;
  t.status = 'stopped';
  log(t, 'sys', why);
  denyPending(t.id, why);
  procs.get(t.id)?.kill('SIGTERM');
  if (!procs.has(t.id)) noteRun(t.schedule ? t : null); // a queued run never reaches the close handler
}

function tick() {
  for (const t of state.tasks) { // tasks are in id order and wait only on earlier ids, so one pass covers a chain
    if (t.status !== 'queued') continue;
    const dep = deps(t).map(id => state.tasks.find(d => d.id === id)).find(d => d && ['failed', 'stopped'].includes(d.status));
    if (dep) {
      t.status = 'failed';
      log(t, 'sys', `Blocked: task #${dep.id} did not finish.`);
      if (t.parent) wakeBoss(t.parent);
    }
  }
  for (const a of approvals.values())
    if (a.status === 'pending' && Date.now() - a.created > ASK_TIMEOUT_MS) Object.assign(a, { status: 'deny', message: 'Nobody answered in 30 minutes, so the call was denied.' });
  if (!setup.problem && !breakerTripped(state.limits)) { // no runs until sign-in is a Claude plan
    const held = breakerTripped(state.limits, Date.now(), SCHED_UTIL); // a scheduled run that has not started waits at this lower limit
    for (const t of pickRunnable(held ? state.tasks.filter(x => !(x.schedule && !x.started && x.status === 'queued')) : state.tasks)) run(t);
  }
  changed();
}

// ---------- schedules: the timer ----------
// The server owns the timer. A due schedule adds a normal queued task (with `schedule` and `slot`), so the breaker,
// one run per nimion, worktrees and the boss's delegate-and-review loop all apply to it unchanged.
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
const liveSchedules = () => state.schedules.filter(s => !s.deleted);
const addHistory = (s, h) => { s.history = [...(s.history || []), h].slice(-SCHED.keep); };
const firedSince = since => state.schedules.reduce((n, s) => n + (s.history || []).filter(h => h.task && h.at > since).length, 0);
const pauseSchedule = (s, why = null) => Object.assign(s, { paused: true, pausedWhy: why, nextAt: null });
let lastSchedTick = Date.now();

// After a slot is handled: the next slot, or the end of the schedule.
function advance(s, now) {
  if (s.paused) return;
  s.nextAt = s.cron ? nextAfter(s.cron, now) : null;
  if (s.nextAt && s.until && s.nextAt > s.until) s.nextAt = null;
  if (!s.nextAt) pauseSchedule(s, s.cron ? 'Finished: past its end date.' : 'Finished: it ran once.');
}

// One run of a schedule, now.
function fireSchedule(s, slot, missed = 0) {
  const last = state.tasks.findLast(t => t.schedule === s.id && t.result), boss = !!CREW.find(c => c.name === s.nimion)?.boss;
  const attach = (s.attach || []).filter(a => fs.existsSync(a.path)), gone = (s.attach || []).filter(a => !attach.includes(a)).map(a => a.name);
  s.runs = (s.runs || 0) + 1;
  const prompt = runHeader(s, { slot, n: s.runs, missed, last, boss }) + (gone.length ? `\n\nThese attachments are gone, so this run goes without them: ${gone.join(', ')}.` : '');
  const t = addTask(prompt, s.nimion, { schedule: s.id, slot, ...(attach.length && { attach }) });
  t.title = `⏰ ${s.name}`.slice(0, 90);
  addHistory(s, { slot, at: Date.now(), task: t.id, status: 'queued', ...(missed && { why: `${missed} earlier run(s) missed, so the latest ran once.` }) });
  console.log(`${new Date().toISOString()} schedule #${s.id} ${s.name}: run ${s.runs} as task #${t.id}${missed ? ` (${missed} missed)` : ''}`);
  if (s.maxRuns && s.runs >= s.maxRuns) pauseSchedule(s, `Finished: ran ${s.runs} of ${s.maxRuns} times.`);
  return t;
}

// Every 15 seconds: start what is due. A long gap since the last tick means the Mac slept (or the process was stopped).
function scheduleTick(now = Date.now()) {
  const slept = now - lastSchedTick > 45_000;
  lastSchedTick = now;
  const names = CREW.map(c => c.name), limited = breakerTripped(state.limits, now, SCHED_UTIL);
  let any = false;
  for (const s of liveSchedules()) {
    const due = dueSlot(s, now);
    if (!due) continue;
    any = true;
    if (state.tasks.some(t => t.schedule === s.id && t.slot === due.slot)) { advance(s, now); continue; } // fired before a crash or restart
    const d = slotDecision(s, due.slot, { now, tasks: state.tasks, names, firedLastHour: firedSince(now - 3600_000), limited });
    if (d.act === 'pause') { pauseSchedule(s, d.why); continue; }
    if (d.act === 'fire') fireSchedule(s, due.slot, due.missed);
    else {
      addHistory(s, { slot: due.slot, at: now, status: d.status, why: d.why });
      console.log(`${new Date(now).toISOString()} schedule #${s.id} ${s.name}: ${d.why}`);
      if (!s.cron && d.status === 'missed') { pauseSchedule(s, 'Missed: more than 6 hours late. Run it now or pick a new time.'); continue; }
    }
    advance(s, now);
  }
  if (any) changed();
  if (any || slept) tick();
}

// A scheduled run changed state: keep its history line up to date, and pause the schedule after 3 failures in a row.
function noteRun(t) {
  const s = t && state.schedules.find(x => x.id === t.schedule), h = s?.history?.find(x => x.task === t.id);
  if (!h) return;
  const open = t.status === 'queued' || state.tasks.some(k => k.parent === t.id && ['queued', 'working', 'needs-you'].includes(k.status));
  const status = open ? 'working' : t.status; // a boss run is finished when its crew is
  if (status === h.status) return;
  Object.assign(h, { status, ms: t.ms });
  if (status === 'done') s.fails = 0;
  if (status === 'failed' || status === 'stopped') {
    s.fails = (s.fails || 0) + 1;
    if (s.fails >= SCHED.failPause && !s.paused) pauseSchedule(s, `${s.fails} runs in a row did not finish.`);
  }
  changed();
}

// Every change to schedules, from the popup or the boss's block. Returns { s, msg }. Each change can be undone once.
const UNDO_KEYS = ['name', 'nimion', 'prompt', 'cron', 'once', 'overlap', 'catchUp', 'atLimit', 'carry', 'maxRuns', 'until', 'attach', 'paused', 'pausedWhy', 'nextAt', 'deleted'];
function scheduleOp(op = {}, by = 'you') {
  const now = Date.now(), names = CREW.map(c => c.name), kind = String(op.op || (op.id ? 'edit' : 'add'));
  if (kind === 'add') {
    if (liveSchedules().length >= SCHED.max) throw new Error(`There can be at most ${SCHED.max} schedules.`);
    const f = checkSchedule(op, null, { names, now }), attach = checkAttach(op.attach);
    const s = { id: state.nextScheduleId++, ...f, attach, tz: localTz(), paused: false, pausedWhy: null, runs: 0, fails: 0, history: [], by, created: now, updated: now, undo: 'add' };
    s.nextAt = s.cron ? nextAfter(s.cron, now) : s.once;
    state.schedules.push(s);
    changed();
    return { s, msg: `Scheduled ${scheduleLine(s)}.` };
  }
  const s = state.schedules.find(x => x.id === Number(op.id) && (!x.deleted || kind === 'undo'));
  if (!s) throw new Error(`There is no schedule #${op.id}.`);
  const before = Object.fromEntries(UNDO_KEYS.map(k => [k, s[k]]));
  let msg;
  if (kind === 'edit') {
    const f = checkSchedule(op, s, { names, now }), attach = op.attach !== undefined ? checkAttach(op.attach) : s.attach;
    const next = f.cron ? nextAfter(f.cron, now) : f.once > now - 60_000 ? f.once : null;
    if (!s.paused && !next) throw new Error('Its time has passed. Pick a new time.');
    Object.assign(s, f, { attach, updated: now }, !s.paused && { nextAt: next });
    msg = `Changed ${scheduleLine(s)}.`;
  } else if (kind === 'pause') {
    pauseSchedule(s, by === 'you' ? null : `paused by ${by}`);
    msg = `Paused ${scheduleLine(s)}.`;
  } else if (kind === 'resume') {
    if (s.maxRuns && s.runs >= s.maxRuns) throw new Error(`It has run ${s.runs} of ${s.maxRuns} times. Raise the limit first.`);
    const next = s.cron ? nextAfter(s.cron, now) : s.once > now ? s.once : null;
    if (!next) throw new Error('Its time has passed. Edit it to pick a new time.');
    Object.assign(s, { paused: false, pausedWhy: null, fails: 0, nextAt: next });
    msg = `Resumed ${scheduleLine(s)}.`;
  } else if (kind === 'delete') {
    s.deleted = now; // kept, so undo works and its jobs keep their link; hidden everywhere
    msg = `Deleted #${s.id} "${s.name}". Its past jobs stay in history.`;
  } else if (kind === 'run') {
    if (openRuns(s, state.tasks).length) throw new Error(`"${s.name}" is running already.`);
    if (firedSince(now - 3600_000) >= SCHED.perHour) throw new Error(`${SCHED.perHour} scheduled runs started in the last hour. Wait a little.`);
    if (!names.includes(s.nimion)) throw new Error(`${s.nimion} is not in the crew.`);
    const t = fireSchedule(s, now);
    tick();
    msg = `Started a run of "${s.name}" now: job #${t.id}.`;
  } else if (kind === 'undo') {
    if (!s.undo) throw new Error('Nothing to undo.');
    if (s.undo === 'add') s.deleted = now;
    else Object.assign(s, s.undo);
    if (!s.paused && !s.deleted) s.nextAt = s.cron ? nextAfter(s.cron, now) : s.once > now ? s.once : null;
    if (!s.paused && !s.deleted && !s.nextAt) pauseSchedule(s, 'Its time has passed. Edit it to pick a new time.');
    s.undo = undefined;
    changed();
    return { s, msg: `Undid the last change to #${s.id} "${s.name}".` };
  } else throw new Error(`Unknown change "${kind}". Use add, edit, pause, resume, delete or run.`);
  if (kind !== 'run') s.undo = before;
  changed();
  return { s, msg };
}

// Every schedule as text for the boss: its rule, the next 3 runs, the last 5 runs and the job. Every word of q must match.
function schedulesText(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = liveSchedules().filter(s => words.every(w => `${s.name} ${s.nimion} ${s.prompt}`.toLowerCase().includes(w)));
  return list.map(s => {
    const next = [];
    if (!s.paused) for (let t = s.nextAt; t && next.length < 3; t = s.cron ? nextAfter(s.cron, t) : null) next.push(fmtTime(t));
    const runs = (s.history || []).slice(-5).reverse().map(h => `${h.task ? `#${h.task} ${h.status}` : h.status} (${fmtTime(h.slot)})${h.why ? `: ${h.why}` : ''}`);
    return `${scheduleLine(s)}${next.length ? `\n   next runs: ${next.join(', ')}` : ''}\n   ${s.runs || 0} run(s)${runs.length ? `, latest: ${runs.join('; ')}` : ''}\n   job: ${s.prompt.replace(/\s+/g, ' ').slice(0, 400)}`;
  }).join('\n') || (words.length ? 'No schedule matches.' : 'No schedules.');
}

// The boss's ```schedule block, applied when its run ends. Returns the errors, or null.
function applyScheduleBlock(t) {
  const parsed = parseSchedule(t.result);
  if (!parsed) return null;
  if (t.schedule) { log(t, 'sys', '⏰ A scheduled run cannot change schedules, so its ```schedule block was ignored.'); return null; }
  const errs = parsed.error ? [parsed.error] : [];
  for (const op of parsed.ops) {
    try { const { s, msg } = scheduleOp(op, `${t.nimion} (task #${t.id})`); log(t, 'sys', `⏰ ${msg}`, { sched: s.id }); }
    catch (e) { errs.push(`${op.op || 'add'}${op.id ? ` #${op.id}` : ''}: ${e.message}`); log(t, 'err', `⏰ Not done: ${errs.at(-1)}`); }
  }
  if (parsed.error) log(t, 'err', `⏰ ${parsed.error}`);
  return errs.length ? errs : null;
}

// ---------- http ----------

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', d => { n += d.length; if (n > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const body = async req => JSON.parse((await readBody(req, 200_000)).toString() || '{}');

// ---------- attachments ----------

const MAX_ATTACH_BYTES = MAX_ATTACH_MB * 1024 * 1024;

function saveCopy(name, data) { // data is the uploaded bytes, or a path to copy
  const dir = path.join(ATTACH_DIR, randomBytes(4).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, safeName(name));
  if (Buffer.isBuffer(data)) fs.writeFileSync(dest, data); else fs.copyFileSync(data, dest);
  return { path: dest, kind: 'file', name: path.basename(dest), size: fs.statSync(dest).size };
}

// A path the human typed: a folder is used in place (read-only), a file is copied.
function attachPath(p, folderOnly = false) {
  const abs = path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
  let st;
  try { st = fs.statSync(abs); } catch { throw new Error(`Not found: ${abs}`); }
  if (st.isDirectory()) {
    if (abs === path.parse(abs).root || abs === os.homedir()) throw new Error('That folder is too broad. Pick a folder inside it.');
    return { path: abs, kind: 'dir', name: path.basename(abs) };
  }
  if (folderOnly) throw new Error('Link a folder here. To give one task a file, attach it to that task instead.');
  if (!st.isFile()) throw new Error(`Not a file or folder: ${abs}`);
  if (st.size > MAX_ATTACH_BYTES) throw new Error(`Files must be under ${MAX_ATTACH_MB} MB.`);
  return saveCopy(path.basename(abs), abs);
}

// Attachments sent with a task or reply: a copy this server made, or a folder.
function checkAttach(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > MAX_ATTACHMENTS) throw new Error(`Send at most ${MAX_ATTACHMENTS} attachments.`);
  return list.map(p => {
    const abs = path.resolve(String(p));
    let st;
    try { st = fs.statSync(abs); } catch { throw new Error(`Attachment is gone: ${abs}`); }
    if (st.isDirectory()) return attachPath(abs);
    if (!abs.startsWith(ATTACH_DIR + path.sep)) throw new Error(`Attach files through /api/attach first: ${abs}`);
    return { path: abs, kind: 'file', name: path.basename(abs), size: st.size };
  });
}

// ---------- files the crew mentions: link, preview, open ----------
const realOrNull = f => { try { return fs.realpathSync(f); } catch { return null; } };
const fileRoots = () => [WORKDIR, HOME].map(realOrNull).filter(Boolean); // the crew folder and the data home (worktrees, attachments)
function fileBases(t) {
  const kids = t ? state.tasks.filter(k => k.parent === t.id).map(k => k.cwd) : [];
  return [t?.cwd, ...kids, WORKDIR, HOME];
}
const TEXT_EXT = /\.(md|markdown|txt|log|csv|tsv|json|ya?ml|toml|xml|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|sh|sql|css|ini|env\.example)$/i;
const FILE_TYPE = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function serveFile(res, url) {
  const f = resolveFile(decodeURIComponent(url.pathname.slice('/files'.length)), [], fileRoots(), realOrNull);
  if (!f || !fs.statSync(f).isFile()) return send(res, 404, { error: 'No such file in the crew folder.' });
  if (/\.(md|markdown)$/i.test(f) && url.searchParams.has('view')) { // a readable page for "open in browser"
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>${path.basename(f).replace(/[<&]/g, '')}</title><style>body{font:15px/1.55 system-ui;max-width:860px;margin:32px auto;padding:0 16px;color-scheme:light dark}pre{overflow:auto;background:#8881;padding:10px;border-radius:8px}table{border-collapse:collapse}td,th{border:1px solid #8885;padding:4px 8px}</style>` +
      `<script src="/md.js"></script><div id="md"></div><script>document.getElementById('md').innerHTML=md(${JSON.stringify(fs.readFileSync(f, 'utf8')).replace(/</g, '\\u003c')})</script>`);
  }
  const head = { 'content-type': FILE_TYPE[path.extname(f).toLowerCase()] || (TEXT_EXT.test(f) ? 'text/plain; charset=utf-8' : 'application/octet-stream'), 'cache-control': 'no-cache' };
  if (/\.(html?|svg)$/i.test(f)) head['content-security-policy'] = 'sandbox allow-scripts'; // a crew-made page runs, but can't reach this app's API
  res.writeHead(200, head);
  fs.createReadStream(f).pipe(res);
}

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/md.js': ['md.js', 'text/javascript; charset=utf-8'],
  '/world.js': ['world.js', 'text/javascript; charset=utf-8'],
  '/games.js': ['games.js', 'text/javascript; charset=utf-8'],
  '/lab3d.js': ['lab3d.js', 'text/javascript; charset=utf-8'],
  '/lab3d-demo.html': ['lab3d-demo.html', 'text/html; charset=utf-8'],
  '/vendor/three/three.module.min.js': ['vendor/three/three.module.min.js', 'text/javascript; charset=utf-8'],
  '/vendor/three/addons/controls/OrbitControls.js': ['vendor/three/addons/controls/OrbitControls.js', 'text/javascript; charset=utf-8'],
};
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const text = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function handle(req, res) {
  // Local only: block other websites (CSRF) and DNS rebinding from driving your agents.
  const host = req.headers.host || '';
  const origin = req.headers.origin;
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || (origin && origin !== `http://${host}`)) return send(res, 403, { error: 'forbidden' });

  const url = new URL(req.url, `http://${host}`);
  if (req.method === 'GET' && url.pathname === '/classic.js') { // an optional local look pack: an empty script unless HQ_CLASSIC=1 and the file is here
    const pack = path.join(HERE, 'classic.local.js'), on = process.env.HQ_CLASSIC === '1' && fs.existsSync(pack);
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
    return on ? fs.createReadStream(pack).pipe(res) : res.end('');
  }
  const file = req.method === 'GET' && STATIC[url.pathname];
  if (file && fs.existsSync(path.join(HERE, file[0]))) {
    res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-cache' });
    return fs.createReadStream(path.join(HERE, file[0])).pipe(res);
  }
  if (req.method === 'GET' && url.pathname.startsWith('/files/')) return serveFile(res, url);
  const sse = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' };
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, sse);
    res.write(`data: ${JSON.stringify(summary())}\n\n`);
    clients.add(res);
    return req.on('close', () => clients.delete(res));
  }
  if (req.method === 'GET' && url.pathname === '/api/logs') { // recent lines first, then every new line as it happens
    res.writeHead(200, sse);
    for (const l of feed) res.write(`data: ${JSON.stringify(l)}\n\n`);
    feedClients.add(res);
    return req.on('close', () => feedClients.delete(res));
  }
  if (req.method === 'GET' && url.pathname === '/api/crew') return send(res, 200, CREW);
  if (req.method === 'GET' && url.pathname === '/api/deliverables') { // every file the crew made, cleared jobs included, newest first
    const byId = new Map(state.tasks.map(t => [t.id, t])), rootOf = t => { for (let i = 0; t.parent && byId.has(t.parent) && i < 50; i++) t = byId.get(t.parent); return t; };
    const hits = state.tasks.flatMap(t => (t.files || []).map(f => { const r = rootOf(t); return { ...f, task: t.id, title: t.title, nimion: t.nimion, thread: r.id, threadTitle: r.title }; }));
    return send(res, 200, deliverables(hits, p => !!resolveFile(p, [], fileRoots(), realOrNull)));
  }
  if (req.method === 'GET' && url.pathname === '/api/crew/stats') return send(res, 200, crewStats(state.tasks, CREW.map(c => c.name)));
  if (req.method === 'GET' && url.pathname === '/api/skills') return send(res, 200, skillList());
  const m = url.pathname.match(/^\/api\/tasks\/(\d+)(?:\/(stop|reply))?$/);
  const t = m && state.tasks.find(x => x.id === Number(m[1]));
  const am = url.pathname.match(/^\/api\/approvals\/(\d+)(?:\/(decide))?$/);
  const a = am && approvals.get(Number(am[1]));
  if (req.method === 'GET' && m && !m[2]) return t ? send(res, 200, t) : send(res, 404, { error: 'no such task' });
  if (req.method === 'GET' && url.pathname === '/api/history') { // search past jobs (the job switcher and nimions' history_search)
    const q = url.searchParams;
    return send(res, 200, searchJobs(state.tasks, { q: q.get('q') || '', nimion: q.get('nimion') || '', limit: Math.min(Number(q.get('limit')) || 25, 500) }));
  }
  if (req.method === 'GET' && url.pathname === '/api/schedules') return send(res, 200, liveSchedules());
  if (req.method === 'GET' && url.pathname === '/api/schedules/text') return send(res, 200, { text: schedulesText(url.searchParams.get('q') || '') }); // schedule_list
  const hm = url.pathname.match(/^\/api\/history\/(\d+)$/); // one past job as text, for history_get
  if (req.method === 'GET' && hm) {
    const j = state.tasks.find(x => x.id === Number(hm[1]));
    if (!j) return send(res, 404, { error: 'no such job' });
    const kids = state.tasks.filter(x => x.parent === j.id).map(x => `- #${x.id} ${x.nimion}, ${x.status}: ${x.title}`).join('\n');
    const lines = j.log.map(l => `[${new Date(l.at).toISOString().slice(0, 16)}] ${l.k}: ${l.t}`).join('\n');
    const text = `Job #${j.id} for ${j.nimion}, ${j.status}, created ${new Date(j.created).toISOString().slice(0, 16)}${j.parent ? `, a step of job #${j.parent}` : ''}\n\n` +
      `${kids ? `Steps handed out:\n${kids}\n\n` : ''}Conversation:\n${lines}`;
    return send(res, 200, { text: text.length > 30000 ? text.slice(0, 2000) + '\n…(older lines cut)…\n' + text.slice(-28000) : text });
  }
  if (req.method === 'GET' && am && !am[2]) {
    if (!a) return send(res, 404, { error: 'no such approval' });
    if (a.status !== 'pending') approvals.delete(a.id); // the bridge reads a decision once
    return send(res, 200, { status: a.status, message: a.message });
  }

  if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
  const ct = String(req.headers['content-type']);
  const tooBig = { error: `Files must be under ${MAX_ATTACH_MB} MB.` };
  if (url.pathname === '/api/attach' && ct.startsWith('application/octet-stream')) { // a file uploaded from the browser
    if (Number(req.headers['content-length']) > MAX_ATTACH_BYTES) return send(res, 413, tooBig);
    let buf, name = '';
    try { buf = await readBody(req, MAX_ATTACH_BYTES); } catch { return send(res, 413, tooBig); }
    try { name = decodeURIComponent(req.headers['x-filename'] || ''); } catch { /* keep the default name */ }
    return send(res, 201, saveCopy(name || 'file', buf));
  }
  if (!ct.startsWith('application/json')) return send(res, 415, { error: 'json only' });
  let b;
  try { b = await body(req); } catch { return send(res, 400, { error: 'bad json' }); }

  if (url.pathname === '/api/attach') { // a local path typed by the human
    const p = text(b.path);
    if (!p) return send(res, 400, { error: 'need a path' });
    try { return send(res, 201, attachPath(p)); } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (url.pathname === '/api/context') { // link a folder for the whole crew
    const p = text(b.path);
    if (!p) return send(res, 400, { error: 'need a folder path' });
    let c;
    try { c = attachPath(p, true); } catch (e) { return send(res, 400, { error: e.message }); }
    if (state.context.some(x => x.path === c.path)) return send(res, 400, { error: 'That folder is already linked.' });
    if (state.context.length >= MAX_ATTACHMENTS) return send(res, 400, { error: `Link at most ${MAX_ATTACHMENTS} folders.` });
    state.context.push({ path: c.path, name: c.name, ...(text(b.note) && { note: text(b.note).slice(0, 200) }) });
    changed();
    return send(res, 201, c);
  }
  if (url.pathname === '/api/context/remove') {
    state.context = state.context.filter(x => x.path !== b.path);
    changed();
    return send(res, 200, {});
  }
  if (url.pathname === '/api/setup') { // re-check sign-in; with {mcp:true} also list MCP servers (slow: it connects to each)
    const [, mcp] = await Promise.all([checkSetup(), b.mcp ? sh(['mcp', 'list'], 90_000) : null]);
    return send(res, 200, { ...setup, node: process.version, workdir: WORKDIR, git: isGit, mcp: b.mcp ? parseMcpList(mcp) : undefined });
  }
  if (url.pathname === '/api/memory') { // the human edits the boss's memory, or undoes its last change
    const text = b.undo ? state.memory?.prev ?? '' : typeof b.text === 'string' ? b.text.trim() : null;
    if (text === null || text.length > MEMORY_MAX) return send(res, 400, { error: `Memory is text up to ${MEMORY_MAX} characters.` });
    state.memory = { text, at: Date.now(), by: b.undo ? 'you (undo)' : 'you', prev: state.memory?.text };
    changed();
    return send(res, 200, {});
  }
  if (url.pathname === '/api/skills/probe') { // find out which skills a run can load
    try { await probeSkills(); } catch (e) { return send(res, 400, { error: e.message }); }
    return send(res, 200, skillList());
  }
  if (url.pathname === '/api/files') { // which of the paths a reply mentions are real files, as absolute paths
    const t = state.tasks.find(x => x.id === Number(b.task)), roots = fileRoots(), bases = fileBases(t), found = {};
    for (const raw of (Array.isArray(b.paths) ? b.paths : []).slice(0, 200)) found[raw] = resolveFile(raw, bases, roots, realOrNull);
    return send(res, 200, { found });
  }
  if (url.pathname === '/api/open') { // open a crew file in Finder, VS Code or the default app; execFile, never a shell
    const f = resolveFile(b.path, [], fileRoots(), realOrNull), how = OPEN_WITH[b.how] || OPEN_WITH.default;
    if (!f || !path.isAbsolute(String(b.path))) return send(res, 404, { error: 'No such file in the crew folder.' });
    const [cmd, args] = how(f);
    return execFile(cmd, args, err => (err && b.how === 'vscode'
      ? execFile('code', [f], e2 => send(res, e2 ? 500 : 200, e2 ? { error: 'VS Code was not found.' } : { ok: true }))
      : send(res, err ? 500 : 200, err ? { error: err.message } : { ok: true })));
  }
  if (url.pathname === '/api/schedules/preview') { // the next times a rule would run; no side effects
    try {
      const now = Date.now(), n = Math.min(Math.max(Number(b.n) || 5, 1), 20), times = [];
      if (text(b.cron)) {
        const c = parseCron(b.cron);
        for (let t = nextAfter(c, now); t && times.length < n; t = nextAfter(c, t)) times.push(t);
        if (!times.length) throw new Error('That repeat rule never runs.');
        if (times.some((t, i) => i && t - times[i - 1] < SCHED.minGapMs)) throw new Error('Runs must be at least 15 minutes apart.');
      } else if (text(b.in) || text(b.at)) {
        const t = text(b.in) ? now + parseIn(b.in) : toTime(b.at);
        if (t < now - 60_000) throw new Error('That time has passed.');
        times.push(t);
      } else throw new Error('Give cron, at or in.');
      return send(res, 200, { times, tz: localTz(), words: text(b.cron) ? globalThis.HQW.describeCron(b.cron) : null });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  const sm = url.pathname.match(/^\/api\/schedules(?:\/(\d+)\/(pause|resume|run|delete|undo))?$/);
  if (sm) { // add or edit (with an id) a schedule, or change one: the same path the boss's ```schedule block takes
    try {
      const { s, msg } = scheduleOp(sm[1] ? { op: sm[2], id: Number(sm[1]) } : { ...b, op: b.id ? 'edit' : 'add' }, 'you');
      return send(res, sm[1] || b.id ? 200 : 201, { schedule: s, msg });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (url.pathname === '/api/games') { // an arcade score
    try { state.games = addScore(state.games, b.game, b.score); } catch (e) { return send(res, 400, { error: e.message }); }
    changed();
    return send(res, 200, state.games[b.game]);
  }
  if (url.pathname === '/api/crew') { // add a nimion, or edit one when `edit` is true
    const existing = CREW.find(c => c.name.toLowerCase() === String(b.name ?? '').trim().toLowerCase());
    if (existing && !b.edit) return send(res, 400, { error: `There is already a nimion called ${existing.name}.` });
    if (!existing && b.edit) return send(res, 404, { error: 'No such nimion.' });
    let nm;
    try { nm = checkNimion(b, existing, state.skillsSeen ? new Set(state.skillsSeen.names) : null); } catch (e) { return send(res, 400, { error: e.message }); }
    CREW = existing ? CREW.map(c => (c === existing ? nm : c)) : [...CREW, nm];
    saveCrew();
    changed();
    return send(res, existing ? 200 : 201, nm);
  }
  if (url.pathname === '/api/crew/remove') {
    const c = CREW.find(x => x.name === b.name);
    if (!c) return send(res, 404, { error: 'No such nimion.' });
    if (c.boss) return send(res, 400, { error: 'The boss stays. You can edit it instead.' });
    if (state.tasks.some(x => x.nimion === c.name && ['queued', 'working', 'needs-you'].includes(x.status)))
      return send(res, 400, { error: `${c.name} still has work. Stop it or let it finish first.` });
    const sch = liveSchedules().filter(s => s.nimion === c.name);
    if (sch.length) return send(res, 400, { error: `${c.name} has ${sch.length} schedule(s): ${sch.map(s => s.name).join(', ')}. Give them to another nimion or delete them first.` });
    CREW = CREW.filter(x => x !== c);
    saveCrew();
    changed();
    return send(res, 200, {});
  }
  if (url.pathname === '/api/tasks') {
    const prompt = text(b.prompt);
    if (!prompt || !CREW.some(c => c.name === b.nimion)) return send(res, 400, { error: 'need a prompt and a crew member' });
    let attach;
    try { attach = checkAttach(b.attach); } catch (e) { return send(res, 400, { error: e.message }); }
    const nt = addTask(prompt, b.nimion, attach.length ? { attach } : {});
    tick();
    return send(res, 201, { id: nt.id });
  }
  if (url.pathname === '/api/clear') {
    for (const x of state.tasks) if (FINISHED.includes(x.status)) x.archived = true; // off the board, still in history
    changed();
    return send(res, 200, {});
  }
  if (url.pathname === '/api/approvals') { // from approve-mcp.mjs, while a run waits
    const task = state.tasks.find(x => x.id === Number(b.task));
    if (!task || task.status !== 'working' || !text(b.tool_name)) return send(res, 400, { error: 'no running task for this request' });
    const na = { id: nextApproval++, taskId: task.id, nimion: task.nimion, tool: b.tool_name, input: b.input ?? {}, status: 'pending', created: Date.now() };
    approvals.set(na.id, na);
    log(task, 'sys', `Asking you: may I use ${na.tool}  ${brief(na.input)}?`);
    changed();
    return send(res, 201, { id: na.id });
  }
  if (am && am[2] === 'decide') {
    if (!a || a.status !== 'pending') return send(res, 404, { error: 'no pending approval' });
    Object.assign(a, b.allow === true ? { status: 'allow' } : { status: 'deny', message: 'Denied by the human.' });
    const task = state.tasks.find(x => x.id === a.taskId);
    if (task) log(task, 'sys', `You ${a.status === 'allow' ? 'allowed' : 'denied'} ${a.tool}.`);
    changed();
    return send(res, 200, {});
  }
  if (!t) return send(res, 404, { error: 'no such task' });
  if (m[2] === 'stop') { stop(t); tick(); return send(res, 200, {}); }
  if (m[2] === 'reply') {
    const prompt = text(b.prompt);
    if (!prompt) return send(res, 400, { error: 'need a reply' });
    let more;
    try { more = checkAttach(b.attach); } catch (e) { return send(res, 400, { error: e.message }); }
    log(t, 'you', prompt + clip(more));
    if (t.status === 'working') { // the run can't take input, so hold the reply until it ends (Stop ends it now)
      const q = t.queuedReply;
      t.queuedReply = q ? { prompt: `${q.prompt}\n\n${prompt}`, more: [...q.more, ...more] } : { prompt, more };
      log(t, 'sys', `Queued: ${t.nimion} reads this when the current run ends. Press Stop to send it now.`);
      changed();
      return send(res, 200, { queued: true });
    }
    applyReply(t, prompt, more);
    tick();
    return send(res, 200, {});
  }
  send(res, 404, { error: 'not found' });
}

function main() {
  fs.mkdirSync(WORKDIR, { recursive: true });
  try { isGit = execFileSync('git', ['-C', WORKDIR, 'rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' }).toString().trim() === 'true'; } catch { isGit = false; }
  // A folder that its repo ignores is not a project to branch: the default ./workspace inside a clone of Nimion HQ is the usual case.
  if (isGit) try { execFileSync('git', ['-C', WORKDIR, 'check-ignore', '-q', '.'], { stdio: 'pipe' }); isGit = false; } catch { /* not ignored: a real project */ }
  load();
  checkSetup();
  http.createServer((req, res) => handle(req, res).catch(e => send(res, 500, { error: e.message }))).listen(PORT, '127.0.0.1', () =>
    console.log(`Nimion HQ on http://localhost:${PORT}\nCrew works in: ${WORKDIR}${isGit ? ' (a git worktree per task)' : ' (shared folder: not a git repo)'}\n` +
      `Runs use your claude.ai login (no API key). Breaker at ${MAX_UTIL * 100}% of a limit window.`));
  setInterval(tick, 60_000); // pick queued work back up once a limit window resets, and expire old approvals
  setInterval(scheduleTick, 15_000); // start due schedules within 15 seconds
  scheduleTick(); // runs missed while Nimion HQ was off catch up now
  tick();
  const bye = () => { for (const c of procs.values()) c.kill('SIGTERM'); saveData(); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
