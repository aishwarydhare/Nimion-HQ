// Run: node test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { SCHED, parseCron, nextAfter, parseIn, toTime, checkSchedule, dueSlot, slotDecision, parseSchedule, scheduleNote, runHeader } from './server.mjs';
import { breakerTripped, pickRunnable, parsePlan, parseQuestion, splitQuestion, parseMemory, searchJobs, authProblem, parseMcpList, cleanEnv, attachNote, safeName, contextNote, checkNimion, parseSkillMd, oneLine, skillNote, crewStats, addScore, resolveFile, inside, FINAL_REPORT, runUsage, windowUsage, toolFile, mentionedPaths, addFile, deliverables } from './server.mjs';

const later = Date.now() / 1000 + 3600, earlier = Date.now() / 1000 - 60;

// breaker
assert.equal(breakerTripped(null), null);
assert.equal(breakerTripped({ unifiedWindows: { seven_day: { utilization: 0.73, resetsAt: later } } }, Date.now(), 0.9), null);
assert.match(breakerTripped({ unifiedWindows: { seven_day: { utilization: 0.95, resetsAt: later } } }, Date.now(), 0.9), /seven-day usage at 95%/);
assert.equal(breakerTripped({ unifiedWindows: { five_hour: { utilization: 0.99, resetsAt: earlier } } }, Date.now(), 0.9), null, 'a reset window no longer blocks');
assert.match(breakerTripped({ isUsingOverage: true, resetsAt: later }), /paid extra usage/);
assert.match(breakerTripped({ unifiedWindows: { five_hour: { utilization: 92, resetsAt: later } } }, Date.now(), 0.9), /92%/, 'percent form');

// scheduler
const T = (id, nimion, status, after) => ({ id, nimion, status, after });
assert.deepEqual(pickRunnable([T(1, 'Pip', 'working'), T(2, 'Pip', 'queued'), T(3, 'Nim', 'queued')]).map(t => t.id), [3], 'one run per nimion');
assert.deepEqual(pickRunnable([T(1, 'Pip', 'queued'), T(2, 'Pip', 'queued')]).map(t => t.id), [1], 'same nimion queues in order');
assert.deepEqual(pickRunnable([T(1, 'Pip', 'working'), T(2, 'Dot', 'queued', 1)]).map(t => t.id), [], 'waits for its dependency');
assert.deepEqual(pickRunnable([T(1, 'Pip', 'done'), T(2, 'Dot', 'queued', 1)]).map(t => t.id), [2]);
assert.deepEqual(pickRunnable([T(2, 'Dot', 'queued', 99)]).map(t => t.id), [2], 'a cleared dependency does not block');
assert.deepEqual(pickRunnable([T(1, 'Pip', 'done'), T(2, 'Nim', 'working'), T(3, 'Dot', 'queued', [1, 2])]).map(t => t.id), [], 'waits for every dependency');
assert.deepEqual(pickRunnable([T(1, 'Pip', 'done'), T(2, 'Nim', 'done'), T(3, 'Dot', 'queued', [1, 2])]).map(t => t.id), [3]);

// boss plan
const names = ['Pip', 'Nim', 'Dot'];
assert.deepEqual(parsePlan('Plan:\n```json\n[{"nimion":"pip","task":"build it"},{"nimion":"Ozz","task":"x"},{"nimion":"Dot","task":" "}]\n```', names), [{ nimion: 'Pip', task: 'build it', after: [] }]);
assert.deepEqual(parsePlan('```json\n[{"nimion":"Nim","task":"a"}]\n```\nthen\n```json\n[{"nimion":"Dot","task":"b"}]\n```', names), [{ nimion: 'Dot', task: 'b', after: [] }], 'last block wins');
const afters = s => parsePlan('```json\n' + s + '\n```', names).map(p => p.after);
assert.deepEqual(afters('[{"nimion":"Pip","task":"a"},{"nimion":"Nim","task":"b"},{"nimion":"Dot","task":"c"}]'), [[], [0], [1]], 'default: one after another');
assert.deepEqual(afters('[{"nimion":"Pip","task":"a"},{"nimion":"Nim","task":"b","after":[]},{"nimion":"Dot","task":"c","after":[0,1,1,5,2]}]'), [[], [], [0, 1]], 'parallel steps then a join; bad indexes dropped');
assert.deepEqual(afters('[{"nimion":"Ozz","task":"a"},{"nimion":"Nim","task":"b"},{"nimion":"Dot","task":"c","after":[0,1]}]'), [[], [0]], 'indexes follow dropped steps');
assert.deepEqual(parsePlan('```json\nnot json\n```', names), []);
assert.deepEqual(parsePlan(undefined, names), []);

// questions for the human
assert.equal(parseQuestion('All done, tests pass.'), null);
assert.equal(parseQuestion('I looked around.\nQUESTION: **Which DB?**\n- Postgres\n- SQLite'), '**Which DB?**\n- Postgres\n- SQLite');
assert.equal(parseQuestion('**QUESTION:** Python or Go?'), 'Python or Go?', 'bold marker');
assert.equal(parseQuestion('The QUESTION: is mid-line'), null, 'only at the start of a line');
assert.equal(parseQuestion(undefined), null);
assert.equal(parseQuestion('QUESTION: **Which?**\n- a\n- b\n\n```json\n[]\n```'), '**Which?**\n- a\n- b', 'code blocks after the ask are dropped');
assert.deepEqual(splitQuestion('**Which DB?**\n- Postgres — I add a migration\n2. SQLite'), { question: '**Which DB?**', options: ['Postgres — I add a migration', 'SQLite'] });
assert.deepEqual(splitQuestion('Python or Go?'), { question: 'Python or Go?', options: [] }, 'no options');
assert.deepEqual(splitQuestion('Ship it?\n- only one bullet'), { question: 'Ship it?\n- only one bullet', options: [] }, 'one bullet is not a choice');
assert.deepEqual(splitQuestion('- a\n- b'), { question: '- a\n- b', options: [] }, 'bullets with no ask stay as text');

// boss memory and job history
assert.equal(parseMemory('Plan done.\n```memory\n- Use metric units\n- Ask before booking\n```\n```json\n[]\n```'), '- Use metric units\n- Ask before booking');
assert.equal(parseMemory('```memory\n- old\n```\nthen\n```memory\n- new\n```'), '- new', 'last block wins');
assert.equal(parseMemory('```memory\n```'), '', 'an empty block clears memory');
assert.equal(parseMemory('no block'), null);
assert.equal(parseMemory(undefined), null);
const jobs = [
  { id: 1, nimion: 'Tork', status: 'done', title: 'Team offsite', prompt: 'plan it', created: 1, log: [{ k: 'say', t: 'Budget is $12k' }] },
  { id: 2, nimion: 'Nim', status: 'done', title: 'Research flights', prompt: 'x', created: 2, parent: 1, log: [] },
  { id: 3, nimion: 'Tork', status: 'failed', title: 'Bug triage', prompt: 'find bugs', created: 3, archived: true, log: [] },
];
assert.deepEqual(searchJobs(jobs).map(j => j.id), [3, 2, 1], 'newest first, cleared jobs included');
assert.deepEqual(searchJobs(jobs, { nimion: 'Tork' }).map(j => j.id), [3, 1]);
assert.deepEqual(searchJobs(jobs, { q: 'BUDGET team' }).map(j => j.id), [1], 'every word, any case, log searched');
assert.equal(searchJobs(jobs, { q: 'budget' })[0].snippet.includes('budget is'), true);
assert.deepEqual(searchJobs(jobs, { limit: 1 }).map(j => j.id), [3]);

// sign-in guard: runs only on a Claude plan
assert.equal(authProblem({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' }), null);
assert.equal(authProblem({ loggedIn: true, authMethod: 'oauth_token' }), null, 'claude setup-token is a plan login');
assert.match(authProblem({ loggedIn: false }), /not signed in/);
assert.match(authProblem({ loggedIn: true, authMethod: 'claude.ai', apiKeySource: 'apiKeyHelper' }), /API key \(apiKeyHelper\)/);
assert.match(authProblem({ loggedIn: true, authMethod: 'api_key' }), /not a Claude plan/);
assert.match(authProblem(null), /did not answer/);
assert.deepEqual(parseMcpList('Checking MCP server health…\n\nclaude.ai Google Drive: https://x.test/mcp?t=secret - ✔ Connected\nplugin:eng:github: https://y.test - ! Needs authentication\nlocal: node s.js - ✘ Failed to connect — HTTP 502: long'),
  [{ name: 'claude.ai Google Drive', ok: true, status: 'Connected' }, { name: 'plugin:eng:github', ok: false, status: 'Needs authentication' }, { name: 'local', ok: false, status: 'Failed to connect' }], 'names and status only, no URLs');

// chat markdown (md.js)
await import('./md.js');
const { md } = globalThis;
assert.equal(md('**a** and `b<c>`'), '<p><b>a</b> and <code>b&lt;c&gt;</code></p>');
assert.equal(md('a\nb\n\nc'), '<p>a<br>b</p><p>c</p>');
assert.equal(md('## Plan'), '<h4>Plan</h4>');
assert.equal(md('- a\n  - b\n- c'), '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>', 'nested list');
assert.equal(md('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
assert.equal(md('```js\nx < 1 **no**\n```'), '<pre><code>x &lt; 1 **no**</code></pre>');
assert.equal(md('| Tier | Cost |\n|---|---|\n| **Lean** | $20k |\n| Std |'),
  '<div class="tbl"><table><thead><tr><th>Tier</th><th>Cost</th></tr></thead><tbody><tr><td><b>Lean</b></td><td>$20k</td></tr><tr><td>Std</td><td></td></tr></tbody></table></div>', 'table, short row padded');
assert.equal(md('Intro:\n| a | b |\n|:--|--:|\n| 1 | 2 |').startsWith('<p>Intro:</p><div class="tbl">'), true, 'table right after a line');
assert.equal(md('2 * 3 * 4 and *it*'), '<p>2 * 3 * 4 and <i>it</i></p>');
assert.ok(!md('<img src=x onerror=alert(1)>').includes('<img'), 'html is escaped');
assert.ok(!md('[x](javascript:alert(1))').includes('href'), 'only http(s) links');
assert.ok(md('see https://example.com/a?b=1&c=2.').includes('href="https://example.com/a?b=1&amp;c=2"'), 'bare url, trailing dot left out');
assert.equal(md('> note\n> more'), '<blockquote><p>note<br>more</p></blockquote>');
assert.equal(md.inline('**b**'), '<b>b</b>');
assert.equal(md(undefined), '');

// child environment
const env = cleanEnv({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_MESSAGING_TOKEN: 's', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'm' });
assert.deepEqual(env, { PATH: '/bin', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_MODEL: 'm' });

// attachments
assert.equal(attachNote([]), '');
assert.match(attachNote([{ path: '/a/b.pdf', kind: 'file', size: 2_500_000 }, { path: '/docs', kind: 'dir' }]), /- \/a\/b\.pdf \(2\.5 MB\)\n- \/docs \(folder\)$/);
assert.equal(safeName('../../evil name?.txt'), 'evil name_.txt', 'no path tricks');
assert.equal(safeName('..'), 'file');
assert.equal(safeName(''), 'file');

// linked context
assert.equal(contextNote([]), '');
assert.match(contextNote([{ path: '/w/docs', note: 'API docs' }, { path: '/w/infra' }]), /- \/w\/docs — API docs\n- \/w\/infra$/);

// crew editor input
assert.deepEqual(checkNimion({ name: 'Zed', title: 'Designer', role: 'You design.', look: { eyes: 1, prop: 'paintbrush', tone: '#ffcc00' }, model: 'sonnet', allow: ['WebSearch', ' '] }),
  { name: 'Zed', title: 'Designer', role: 'You design.', look: { eyes: 1, prop: 'paintbrush', tone: '#ffcc00' }, model: 'sonnet', allow: ['WebSearch'] });
assert.throws(() => checkNimion({ name: '1bad', title: 't', role: 'r' }), /Name/);
assert.throws(() => checkNimion({ name: 'Ok', title: '', role: 'r' }), /Title/);
assert.throws(() => checkNimion({ name: 'Ok', title: 't', role: 'r', model: 'x; rm -rf /' }), /Model/);
assert.deepEqual(checkNimion({ name: 'A', title: 't', role: 'r', look: { prop: '<script>', tone: 'red' } }).look, { eyes: 2, prop: 'none' });
assert.deepEqual(checkNimion({ name: 'A', title: 't', role: 'r', look: { eyes: 1, style: 'tuft' } }).look, { eyes: 1, prop: 'none', style: 'tuft' });
assert.equal('style' in checkNimion({ name: 'A', title: 't', role: 'r', look: { style: 'goggles' } }).look, false, 'an unknown style is not saved');
const edited = checkNimion({ name: 'Renamed', title: 't', role: 'r' }, { name: 'Tork', boss: true });
assert.equal(edited.name, 'Tork', 'an edit keeps the name');
assert.equal(edited.boss, true, 'an edit keeps the boss flag');

// skills per nimion
assert.deepEqual(checkNimion({ name: 'Pip', title: 't', role: 'r', skills: ['engineering:code-review', ' rca ', 'rca', ''] }).skills, ['engineering:code-review', 'rca'], 'trimmed and deduped');
assert.equal('skills' in checkNimion({ name: 'Pip', title: 't', role: 'r', skills: [] }), false, 'no empty list saved');
assert.throws(() => checkNimion({ name: 'Pip', title: 't', role: 'r', skills: ['bad name;rm'] }), /Skills/);
assert.throws(() => checkNimion({ name: 'Pip', title: 't', role: 'r', skills: ['gone'] }, undefined, new Set(['rca'])), /Not installed.*gone/);
assert.deepEqual(checkNimion({ name: 'Pip', title: 't', role: 'r', skills: ['old', 'rca'] }, { name: 'Pip', skills: ['old'] }, new Set(['rca'])).skills, ['old', 'rca'], 'a skill it already had may stay');
assert.deepEqual(parseSkillMd('---\nname: rca\ndescription: Draft an RCA. Use it for postmortems.\n---\n# body'), { name: 'rca', description: 'Draft an RCA. Use it for postmortems.' });
assert.deepEqual(parseSkillMd('---\nname: "x"\ndescription: >\n  Folded text\n  on two lines.\nother: 1\n---'), { name: 'x', description: 'Folded text on two lines.' });
assert.equal(parseSkillMd('no front matter'), null);
assert.equal(oneLine('Draft an RCA document. Use it when asked.'), 'Draft an RCA document.');
assert.equal(oneLine('Short. Then more'), 'Short. Then more', 'too short a first sentence keeps going');
assert.equal(skillNote([]), '');
assert.match(skillNote(['rca', 'x'], { rca: 'Draft an RCA.' }), /Skill tool[\s\S]*- rca — Draft an RCA\.\n- x$/);

// NR office stats
const st = crewStats([{ nimion: 'Pip', status: 'done', ms: 1000 }, { nimion: 'Pip', status: 'done', ms: 3000 }, { nimion: 'Pip', status: 'failed' }, { nimion: 'Pip', status: 'queued' }, { nimion: 'Nim', status: 'working' }], ['Pip', 'Nim', 'Dot']);
assert.deepEqual({ ...st.Pip, usage: undefined }, { usage: undefined, done: 2, failed: 1, total: 4, avgMs: 2000, load: 1 });
assert.deepEqual({ ...st.Dot, usage: undefined }, { usage: undefined, done: 0, failed: 0, total: 0, avgMs: null, load: 0 });
assert.equal(st.Nim.load, 1);

// arcade scores
let g = addScore({}, 'catch', 10, 1);
g = addScore(g, 'catch', 30, 2); g = addScore(g, 'catch', 10, 3);
assert.deepEqual(g.catch.map(x => x.score), [30, 10, 10]);
assert.equal(g.catch[1].at, 1, 'earlier wins a tie');
for (let i = 0; i < 9; i++) g = addScore(g, 'stack', i);
assert.deepEqual(g.stack.map(x => x.score), [8, 7, 6, 5, 4], 'best five kept');
assert.throws(() => addScore({}, 'chess', 1), /No such game/);
assert.throws(() => addScore({}, 'match', -1), /whole number/);
assert.throws(() => addScore({}, 'match', 1.5), /whole number/);

// page helpers (world.js)
await import('./world.js');
const { HQW } = globalThis;
assert.deepEqual(HQW.memoryItems('- Keep it short\n\n* Ask first\nplain line\n'), ['Keep it short', 'Ask first', 'plain line']);
assert.equal(HQW.memoryText(['Keep it short', '  two\nlines ', '']), '- Keep it short\n- two lines', 'one bullet per item, blanks dropped');
assert.equal(HQW.memoryText(HQW.memoryItems('- a\n- b')), '- a\n- b', 'round trip');
assert.deepEqual(HQW.parseHash('#job/12', []), { job: 12 });
assert.deepEqual(HQW.parseHash('#mr', ['mr', 'board']), { panel: 'mr' });
assert.deepEqual(HQW.parseHash('#nr', ['mr', 'board']), { panel: 'mr' }, '#nr opens the NR office, whose id is still mr');
assert.equal(HQW.parseHash('#nope', ['mr']), null);
assert.equal(HQW.parseHash('', ['mr']), null);
{ const a = HQW.portrait({ tone: '#ff7aa8', eyes: 1, prop: 'hat' }), b = HQW.portrait({ tone: 'red; x', prop: '<x>' });
  assert.match(a, /^<svg class="mpv"/); assert.match(a, /#ff7aa8/); assert.match(a, /#f08c00/, 'the hat');
  assert.match(b, /#ffaa33/, 'a bad tone falls back to the default colour'); assert.doesNotMatch(b, /<x>/, 'an unknown prop draws nothing');
  assert.notEqual(a.match(/clipPath id="(\w+)"/)[1], b.match(/clipPath id="(\w+)"/)[1], 'each portrait clips with its own id'); }
{ // the three styles, each with what it wears in the nimion's own colour
  const draw = style => HQW.portrait({ style }, '#2f5ea8').replace(/pv\d+/g, ''), sp = draw('sprout'), bo = draw('bobble'), tu = draw('tuft');
  assert.match(sp, /#5cc46a/, 'a sprout has leaves'); assert.match(bo, /L96 116/, 'a bobble has the gumdrop body'); assert.match(tu, /y="104" width="76"/, 'a tuft wears a striped jumper');
  for (const p of [sp, bo, tu]) assert.match(p, /#2f5ea8/, 'what it wears is in its own colour');
  assert.equal(draw('nope'), sp, 'an unknown style draws the first'); assert.equal(draw(undefined), sp);
  assert.doesNotMatch(HQW.portrait({ style: 'sprout', prop: 'hat' }, '#2f5ea8'), /#5cc46a/, 'a hat hides what is on the head');
  assert.deepEqual(HQW.STYLES.map(s => s[0]), ['sprout', 'bobble', 'tuft']);
  assert.equal(HQW.styleOf({ style: 'tuft' }), 'tuft'); assert.equal(HQW.styleOf({}), 'sprout'); assert.equal(HQW.styleOf(null), 'sprout');
  assert.equal(HQW.accent('#ffaa33', '#2f5ea8'), '#2f5ea8', 'a tint that stands out is used as it is');
  assert.notEqual(HQW.accent('#ffaa33', '#f08c00'), '#f08c00', 'a tint too close to the body colour is deepened');
  assert.equal(HQW.accent('#e6e9f0', '#2e9e5b'), '#2e9e5b', 'any tint shows on a grey body');
  assert.equal(HQW.accent('#ffaa33', 'red'), '#f08c00', 'a bad tint falls back'); }

// file links: which paths a reply names, and the guard on opening them
const cands = h => [...h.matchAll(/data-path="([^"]+)"/g)].map(m => m[1]);
assert.deepEqual(cands(md.inline('see `/Users/a/r.html`, `research.md` and [plan](plan/p.md)')), ['/Users/a/r.html', 'research.md', 'plan/p.md']);
assert.deepEqual(cands(md.inline('out/report.md, ~/x/y.csv and file:///tmp/z.pdf.')), ['out/report.md', '~/x/y.csv', 'file:///tmp/z.pdf']);
assert.deepEqual(cands(md.inline('Node.js v2.3, e.g. the /health endpoint and https://x.com/a/b.html')), [], 'no false files in prose or urls');
assert.deepEqual(cands(md.inline('**done.md** and `dir/`')), ['done.md', 'dir/']);
const files = new Set(['/ws/out/r.md', '/home/wt/7/a.html', '/home/data.json', '/etc/passwd', '/ws/link']);
const real = f => (f === '/ws/link' ? '/etc/passwd' : files.has(f) ? f : null); // /ws/link is a symlink out of the crew folder
const roots = ['/ws', '/home'];
assert.equal(resolveFile('out/r.md', ['/home/wt/7', '/ws'], roots, real), '/ws/out/r.md', 'relative: tries each base');
assert.equal(resolveFile('a.html:12', ['/home/wt/7'], roots, real), '/home/wt/7/a.html', 'drops a :line suffix');
assert.equal(resolveFile('file:///ws/out/r.md', [], roots, real), '/ws/out/r.md');
assert.equal(resolveFile('/etc/passwd', [], roots, real), null, 'outside the crew folder and data home');
assert.equal(resolveFile('../../etc/passwd', ['/ws/out'], roots, real), null, 'no climbing out');
assert.equal(resolveFile('/ws/link', [], roots, real), null, 'no symlinks out');
assert.equal(resolveFile('/ws/missing.md', [], roots, real), null);
assert.equal(resolveFile('~/r.md', [], ['/u'], f => (f === '/u/r.md' ? f : null), '/u'), '/u/r.md');
assert.equal(inside('/ws2/x', ['/ws']), false, 'a sibling folder with the same prefix is outside');
assert.match(FINAL_REPORT, /Who did what/); assert.match(FINAL_REPORT, /absolute path/);

// repeat rules in words, and the popup's presets
const dc = HQW.describeCron;
assert.equal(dc('0 9 * * 1-5'), 'Weekdays at 09:00'); assert.equal(dc('0 9 * * *'), 'Every day at 09:00'); assert.equal(dc('30 8 * * 1'), 'Mondays at 08:30');
assert.equal(dc('0 9 * * 5,1,3'), 'Mon, Wed and Fri at 09:00'); assert.equal(dc('0 10 * * 0,6'), 'Weekends at 10:00'); assert.equal(dc('0 9,17 * * *'), 'Every day at 09:00 and 17:00');
assert.equal(dc('0 * * * *'), 'Every hour'); assert.equal(dc('15 * * * *'), 'Every hour at :15'); assert.equal(dc('0 */4 * * *'), 'Every 4 hours'); assert.equal(dc('*/30 * * * *'), 'Every 30 minutes');
assert.equal(dc('0 9 1 * *'), 'On the 1st of each month at 09:00'); assert.equal(dc('0 9 22 * *'), 'On the 22nd of each month at 09:00'); assert.equal(dc('0 9 13 * *'), 'On the 13th of each month at 09:00');
assert.equal(dc('0 9 1 6 *'), '0 9 1 6 *', 'unknown shapes stay as the rule'); assert.equal(dc('0 9 1 * 1'), '0 9 1 * 1'); assert.equal(dc('bad'), 'bad');
for (const p of [{ kind: 'daily', time: '09:00' }, { kind: 'weekdays', time: '07:45' }, { kind: 'weekly', time: '18:00', days: [1, 3, 5] }, { kind: 'hours', every: 4 }, { kind: 'hours', every: 1 }, { kind: 'monthly', time: '09:30', dom: 15 }])
  assert.deepEqual(HQW.presetFromCron(HQW.cronFromPreset(p)), p, `preset round trip: ${p.kind}`);
assert.equal(HQW.cronFromPreset({ kind: 'weekly', time: '09:00', days: ['5', '1'] }), '0 9 * * 1,5');
assert.throws(() => HQW.cronFromPreset({ kind: 'weekly', time: '09:00', days: [] }), /day/);
assert.deepEqual(HQW.presetFromCron('5,35 9 * * *'), { kind: 'cron', cron: '5,35 9 * * *' }, 'no preset: custom rule');
assert.deepEqual(HQW.presetFromCron('0 9 * * 7'), { kind: 'cron', cron: '0 9 * * 7' });

// ---------- schedules ----------
process.env.TZ = 'Europe/London'; // Node reads TZ again when it changes; London has DST on 29 Mar and 25 Oct 2026
const L = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime(); // a local time
const Z = s => Date.parse(s); // a UTC time
// cron parsing
const pc = parseCron('0 9 * * 1-5');
assert.deepEqual([[...pc.min], [...pc.hour], [...pc.dow]], [[0], [9], [1, 2, 3, 4, 5]]);
assert.deepEqual([...parseCron('*/15 * * * *').min], [0, 15, 30, 45]);
assert.deepEqual([...parseCron('5/20 * * * *').min], [5, 25, 45], 'a/n starts at a');
assert.deepEqual([...parseCron('0 0 * * 7').dow], [0], '7 is Sunday');
assert.deepEqual([...parseCron('0 8,12-13 * * *').hour], [8, 12, 13]);
for (const bad of ['0 9 * *', '60 * * * *', 'x * * * *', '5-1 * * * *', '*/0 * * * *', '0 24 * * *', '0 0 0 * *'])
  assert.throws(() => parseCron(bad), Error, bad);
// next slot
assert.equal(new Date(L(2026, 11, 13)).getDay(), 5, '13 Nov 2026 is a Friday');
assert.equal(nextAfter('0 9 * * 1-5', L(2026, 11, 13, 10)), L(2026, 11, 16, 9), 'weekdays 9am: Friday after 9 goes to Monday');
assert.equal(nextAfter('0 9 * * 1-5', L(2026, 11, 16, 8, 59, 30)), L(2026, 11, 16, 9));
assert.equal(nextAfter('0 9 * * 1-5', L(2026, 11, 16, 9)), L(2026, 11, 17, 9), 'strictly after from');
assert.equal(nextAfter('0 12 31 * *', L(2026, 2, 1)), L(2026, 3, 31, 12), 'skips months without a 31st');
assert.equal(nextAfter('0 0 29 2 *', L(2026, 3, 1)), L(2028, 2, 29), 'the next 29 February');
assert.equal(nextAfter('0 0 30 2 *', L(2026, 1, 1)), null, 'never');
assert.equal(nextAfter('0 9 13 * 5', L(2026, 11, 1)), L(2026, 11, 6, 9), 'both days set: either matches (Friday 6th)');
assert.equal(nextAfter('*/15 * * * *', L(2026, 11, 16, 9, 7)), L(2026, 11, 16, 9, 15));
// DST: spring forward (01:00 GMT -> 02:00 BST on 29 Mar) and fall back (02:00 BST -> 01:00 GMT on 25 Oct)
assert.equal(nextAfter('30 1 * * *', Z('2026-03-28T12:00Z')), Z('2026-03-29T01:00Z'), 'a slot in the gap runs at 02:00 BST, the first minute after the jump');
assert.equal(nextAfter('30 1 * * *', Z('2026-03-29T01:00Z')), Z('2026-03-30T00:30Z'), 'and the next day is normal');
assert.equal(nextAfter('30 1 * * *', Z('2026-10-24T12:00Z')), Z('2026-10-25T00:30Z'), 'fall back: the first 01:30');
assert.equal(nextAfter('30 1 * * *', Z('2026-10-25T00:30Z')), Z('2026-10-26T01:30Z'), 'the repeated 01:30 does not run again');
assert.equal(nextAfter('0 * * * *', Z('2026-10-25T00:00Z')), Z('2026-10-25T02:00Z'), 'hourly: the repeated 01:00 runs once');
// lengths and times
assert.equal(parseIn('2h'), 7_200_000); assert.equal(parseIn('1h30m'), 5_400_000); assert.equal(parseIn('in 20 minutes'), 1_200_000); assert.equal(parseIn('1 day'), 86_400_000);
for (const bad of ['soon', '2 months', '30s', '', '0m']) assert.throws(() => parseIn(bad), Error, bad);
assert.equal(toTime('2026-11-16T09:00'), L(2026, 11, 16, 9), 'no offset: local time');
assert.equal(toTime('2026-11-16T09:00Z'), Z('2026-11-16T09:00Z'));
assert.throws(() => toTime('tomorrow'));
// checking a schedule
const now0 = L(2026, 11, 15, 12), crewN = ['Tork', 'Pip'], ck = (b, ex) => checkSchedule(b, ex, { names: crewN, now: now0 });
const s1 = ck({ nimion: 'pip', prompt: ' Summarise PRs ', cron: '0  9 * * 1-5' });
assert.deepEqual([s1.nimion, s1.prompt, s1.name, s1.cron, s1.once, s1.overlap, s1.catchUp, s1.atLimit, s1.carry, s1.maxRuns], ['Pip', 'Summarise PRs', 'Summarise PRs', '0 9 * * 1-5', null, 'skip', 'latest', 'wait', true, null]);
assert.equal(ck({ nimion: 'Tork', prompt: 'x', in: '2h' }).once, now0 + 7_200_000);
assert.equal(ck({ nimion: 'Tork', prompt: 'x', at: '2026-11-15T17:00' }).once, L(2026, 11, 15, 17));
assert.throws(() => ck({ nimion: 'Pip', prompt: 'x', cron: '*/10 * * * *' }), /15 minutes/, 'runaway guard');
assert.throws(() => ck({ nimion: 'Pip', prompt: 'x', cron: '0,5 9 * * *' }), /15 minutes/, 'two slots 5 minutes apart');
assert.throws(() => ck({ nimion: 'Pip', prompt: 'x', at: '2026-11-15T09:00' }), /passed/);
assert.throws(() => ck({ nimion: 'Ozz', prompt: 'x', in: '1h' }), /not in the crew/);
assert.throws(() => ck({ nimion: 'Pip', prompt: 'x', in: '1h', cron: '0 9 * * *' }), /only one/);
assert.throws(() => ck({ nimion: 'Pip', prompt: 'x' }), /Say when/);
assert.throws(() => ck({ nimion: 'Pip', prompt: 'x', in: '1h', overlap: 'pile' }), /overlap/);
const s1e = ck({ prompt: 'New prompt', maxRuns: 5 }, s1);
assert.deepEqual([s1e.cron, s1e.prompt, s1e.name, s1e.maxRuns], ['0 9 * * 1-5', 'New prompt', 'Summarise PRs', 5], 'an edit keeps what it does not change');
assert.equal(ck({ maxRuns: null }, s1e).maxRuns, null, 'null clears the cap');
// due slots and catch-up
const hourly = { id: 7, nimion: 'Pip', cron: '0 * * * *', nextAt: L(2026, 11, 16, 9) };
assert.equal(dueSlot(hourly, L(2026, 11, 16, 8, 59)), null, 'not yet');
assert.deepEqual(dueSlot(hourly, L(2026, 11, 16, 9, 0, 10)), { slot: L(2026, 11, 16, 9), missed: 0 });
assert.deepEqual(dueSlot(hourly, L(2026, 11, 16, 12, 5)), { slot: L(2026, 11, 16, 12), missed: 3 }, 'asleep 3 hours: the latest slot, once');
assert.equal(dueSlot({ ...hourly, paused: true }, L(2026, 11, 16, 12)), null);
assert.deepEqual(dueSlot({ id: 8, once: L(2026, 11, 16, 9), nextAt: L(2026, 11, 16, 9) }, L(2026, 11, 16, 10)), { slot: L(2026, 11, 16, 9), missed: 0 });
const dec = (s, slot, o = {}) => slotDecision(s, slot, { now: L(2026, 11, 16, 12), tasks: [], names: crewN, ...o });
assert.deepEqual(dec(hourly, L(2026, 11, 16, 12)), { act: 'fire' });
assert.equal(dec(hourly, L(2026, 11, 16, 11, 30)).act, 'fire', '30 minutes late still runs');
assert.equal(dec(hourly, L(2026, 11, 16, 5, 59)).status, 'missed', 'more than 6 hours late');
assert.equal(dec({ ...hourly, catchUp: 'none' }, L(2026, 11, 16, 11)).status, 'missed', 'catchUp none skips a late slot');
assert.equal(dec({ ...hourly, catchUp: 'none' }, L(2026, 11, 16, 11, 59, 30)).act, 'fire', 'but not one the tick is only seconds late for');
const run = (id, status, extra) => ({ id, schedule: 7, status, ...extra });
assert.equal(dec(hourly, L(2026, 11, 16, 12), { tasks: [run(1, 'working')] }).status, 'skipped', 'overlap skip');
assert.equal(dec(hourly, L(2026, 11, 16, 12), { tasks: [run(1, 'needs-you')] }).status, 'skipped', 'a run waiting on you is open');
assert.equal(dec(hourly, L(2026, 11, 16, 12), { tasks: [run(1, 'done')] }).act, 'fire');
assert.equal(dec(hourly, L(2026, 11, 16, 12), { tasks: [run(1, 'done'), { id: 2, parent: 1, status: 'working' }] }).status, 'skipped', 'a boss run is open while its crew works');
assert.equal(dec({ ...hourly, overlap: 'queue' }, L(2026, 11, 16, 12), { tasks: [run(1, 'working')] }).act, 'fire', 'queue: one more may wait');
assert.equal(dec({ ...hourly, overlap: 'queue' }, L(2026, 11, 16, 12), { tasks: [run(1, 'working'), run(2, 'queued')] }).status, 'skipped', 'but only one');
assert.equal(dec(hourly, L(2026, 11, 16, 12), { firedLastHour: SCHED.perHour }).status, 'skipped', 'hourly cap');
assert.equal(dec(hourly, L(2026, 11, 16, 12), { limited: 'five-hour usage at 80%' }).act, 'fire', 'atLimit wait: the task waits in the queue');
assert.match(dec({ ...hourly, atLimit: 'skip' }, L(2026, 11, 16, 12), { limited: 'five-hour usage at 80%' }).why, /80%/);
assert.deepEqual(dec({ ...hourly, nimion: 'Gone' }, L(2026, 11, 16, 12)), { act: 'pause', why: 'Gone is not in the crew.' });
// the boss's block
assert.equal(parseSchedule('no block'), null);
assert.deepEqual(parseSchedule('```schedule\n{"op":"pause","id":1}\n```').ops, [{ op: 'pause', id: 1 }], 'one object is one change');
assert.deepEqual(parseSchedule('```schedule\n[{"op":"pause","id":1}]\n```\n```schedule\n[{"op":"delete","id":2}, 5]\n```').ops, [{ op: 'delete', id: 2 }], 'the last block wins; non-objects dropped');
assert.match(parseSchedule('```schedule\n[nope\n```').error, /not valid JSON/);
assert.deepEqual(parsePlan('ok\n```schedule\n[{"op":"add","nimion":"Pip","task":"x","cron":"0 9 * * 1-5"}]\n```\n```json\n[]\n```', names), [], 'the plan ignores a schedule block');
assert.deepEqual(parsePlan('```schedule\n[{"nimion":"Pip","task":"x"}]\n```', names), [], 'even one that looks like a plan');
assert.match(scheduleNote([{ id: 3, name: 'Digest', nimion: 'Pip', cron: '0 9 * * 1-5', nextAt: L(2026, 11, 16, 9), prompt: 'Sum up' }, { id: 4, deleted: 1, name: 'Old', nimion: 'Pip', prompt: 'x' }]), /^- #3 "Digest" for Pip, weekdays at 09:00 \(cron 0 9 \* \* 1-5\), next Mon,? 16 Nov, 09:00\. Job: Sum up$/);
assert.equal(scheduleNote([]), '(none)');
const hdr = runHeader({ name: 'Digest', cron: '0 9 * * 1-5', prompt: 'Sum up', carry: true }, { slot: L(2026, 11, 16, 9), n: 3, missed: 2, last: { id: 9, created: L(2026, 11, 13, 9), result: 'Two PRs.' } });
assert.match(hdr, /^Scheduled run 3 of "Digest"/); assert.match(hdr, /2 earlier run/); assert.match(hdr, /reported:\nTwo PRs\./); assert.match(hdr, /full path/); assert.match(hdr, /---\nSum up$/);
assert.doesNotMatch(runHeader({ name: 'D', prompt: 'p', carry: false }, { slot: 0, n: 1, last: { id: 1, created: 0, result: 'R' }, boss: true }), /reported|full path/, 'carry off, and the boss writes its own report');

// ---------- integration: the real server on a temporary HQ_HOME and port, with a fake `claude` (never port 4321 or your data) ----------
const free = p => new Promise(r => { const t = net.createServer().once('error', () => r(false)).listen(p, '127.0.0.1', () => t.close(() => r(true))); });
let PORT = Number(process.env.HQ_TEST_PORT || 4399);
while (!(await free(PORT))) PORT++; // another dev server may hold 4399: take the next free port, never a busy one
assert.notEqual(PORT, 4321, 'the integration test never uses the live port');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-test-')), bin = path.join(tmp, 'bin'), home = path.join(tmp, 'home');
fs.mkdirSync(bin); fs.mkdirSync(home);
fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('9.9.9 (fake)'); process.exit(0); }
if (a[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'team' })); process.exit(0); }
if (a[0] === 'mcp') process.exit(0);
let input = '';
process.stdin.on('data', d => { input += d; }).on('end', () => {
  const out = o => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'system', subtype: 'init', session_id: 'fake-' + process.pid, skills: [] });
  const result = /please schedule/.test(input) ? 'Sure: weekdays at 09:00.\\n\\u0060\\u0060\\u0060schedule\\n[{"op":"add","name":"Fake digest","nimion":"Pip","prompt":"Sum up PRs","cron":"0 9 * * 1-5"}]\\n\\u0060\\u0060\\u0060\\n\\u0060\\u0060\\u0060json\\n[]\\n\\u0060\\u0060\\u0060' : 'Done (fake).\\n\\u0060\\u0060\\u0060json\\n[]\\n\\u0060\\u0060\\u0060';
  out({ type: 'assistant', message: { content: [{ type: 'text', text: result }] } });
  out({ type: 'result', result, is_error: false, num_turns: 1 });
});
`, { mode: 0o755 });
// A daily slot 3 hours ago (in reach of catch-up), first due yesterday, and a one-off 7 hours late (too late).
const slot = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 3 * 3600_000), yesterday = new Date(slot); yesterday.setDate(slot.getDate() - 1);
const seed = { nextId: 1, tasks: [], limits: null, context: [], futureKey: 'kept by every build', nextScheduleId: 3, schedules: [
  { id: 1, name: 'Caught up', nimion: 'Pip', prompt: 'Daily check', cron: `${slot.getMinutes()} ${slot.getHours()} * * *`, once: null, overlap: 'skip', catchUp: 'latest', atLimit: 'wait', carry: true, maxRuns: null, until: null, attach: [], paused: false, runs: 0, fails: 0, history: [], nextAt: yesterday.getTime() },
  { id: 2, name: 'Too late', nimion: 'Pip', prompt: 'One-off', cron: null, once: Date.now() - 7 * 3600_000, overlap: 'skip', catchUp: 'latest', atLimit: 'wait', carry: true, maxRuns: null, until: null, attach: [], paused: false, runs: 0, fails: 0, history: [], nextAt: Date.now() - 7 * 3600_000 }] };
fs.writeFileSync(path.join(home, 'data.json'), JSON.stringify(seed));
const base = `http://127.0.0.1:${PORT}`, sleep = ms => new Promise(r => setTimeout(r, ms));
const get = p => fetch(base + p).then(r => r.json());
const postJ = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then(async r => ({ code: r.status, ...(await r.json()) }));
const until = async (what, fn, ms = 15_000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) { const v = await fn().catch(() => null); if (v) return v; } throw new Error(`timed out waiting for ${what}`); };
let srv;
const start = async () => {
  srv = spawn(process.execPath, [path.resolve('server.mjs'), path.join(tmp, 'work')], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PORT: String(PORT), HQ_HOME: home, HQ_CLASSIC: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => process.stderr.write(d));
  await until('the server', () => { if (srv.exitCode !== null) throw new Error('the test server exited'); return get('/api/crew'); });
};
const stopSrv = () => new Promise(r => { srv.once('exit', r); srv.kill('SIGTERM'); });
const done = id => until(`task #${id} done`, async () => { const t = await get(`/api/tasks/${id}`); return t.status === 'done' && t; });
try {
  await start();
  assert.equal(await fetch(base + '/classic.js').then(r => r.text()), '', 'no look pack is offered unless the server is asked for one');
  // catch-up at start: the latest missed slot runs once; the one-off that is 7 hours late is skipped and paused
  const caught = await until('the catch-up run', async () => (await get('/api/schedules')).find(s => s.id === 1 && s.history.length));
  assert.equal(caught.history[0].slot, slot.getTime(), 'the latest slot, not yesterday’s');
  const t1 = await done(caught.history[0].task);
  assert.equal(t1.schedule, 1); assert.equal(t1.title, '⏰ Caught up'); assert.match(t1.prompt, /1 earlier run/); assert.equal(t1.log[0].k, 'sys');
  assert.ok(caught.nextAt > Date.now(), 'the next slot is in the future');
  const late = (await get('/api/schedules')).find(s => s.id === 2);
  assert.deepEqual([late.paused, late.history[0].status], [true, 'missed']); assert.match(late.pausedWhy, /Missed/);
  // the API: checks, add, run now, pause, undo, delete, preview, retire guard
  assert.match((await postJ('/api/schedules', { nimion: 'Pip', prompt: 'x', cron: '*/5 * * * *' })).error, /15 minutes/);
  const add = await postJ('/api/schedules', { nimion: 'Nim', name: 'Later', prompt: 'Later job', in: '2h' });
  assert.equal(add.code, 201); const sid = add.schedule.id;
  assert.ok(Math.abs(add.schedule.nextAt - (Date.now() + 7_200_000)) < 10_000);
  const ran = await postJ(`/api/schedules/${sid}/run`);
  assert.match(ran.msg, /Started a run/);
  await until('the run-now history', async () => (await get('/api/schedules')).find(s => s.id === sid).history[0]?.status === 'done');
  assert.equal((await postJ(`/api/schedules/${sid}/pause`)).schedule.paused, true);
  assert.equal((await postJ(`/api/schedules/${sid}/undo`)).schedule.paused, false, 'undo a pause');
  await postJ(`/api/schedules/${sid}/delete`);
  assert.equal((await get('/api/schedules')).some(s => s.id === sid), false, 'deleted schedules are hidden');
  await postJ(`/api/schedules/${sid}/undo`);
  assert.equal((await get('/api/schedules')).some(s => s.id === sid), true, 'undo a delete');
  assert.equal((await postJ('/api/schedules/preview', { cron: '0 9 * * 1-5', n: 3 })).times.length, 3);
  // the boss's read-only tools, through the real MCP bridge
  const mcp = spawn(process.execPath, [path.resolve('approve-mcp.mjs')], { env: { ...process.env, HQ_URL: base, HQ_TASK: '1' }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map(); let mbuf = '';
  mcp.stdout.on('data', d => { mbuf += d; for (let i; (i = mbuf.indexOf('\n')) >= 0; mbuf = mbuf.slice(i + 1)) { const m = JSON.parse(mbuf.slice(0, i)); replies.set(m.id, m); } });
  const rpc = (id, method, params) => { mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); return until(`mcp reply ${id}`, async () => replies.get(id)); };
  const tools = (await rpc(1, 'tools/list')).result.tools.map(t => t.name);
  for (const n of ['approve', 'history_search', 'history_get', 'schedule_list', 'schedule_preview']) assert.ok(tools.includes(n), n);
  const listed = (await rpc(2, 'tools/call', { name: 'schedule_list', arguments: { query: 'later' } })).result.content[0].text;
  assert.match(listed, /"Later" for Nim, once at/); assert.match(listed, /job: Later job/); assert.match(listed, /#\d+ done/);
  assert.match((await rpc(3, 'tools/call', { name: 'schedule_preview', arguments: { cron: '0 9 * * 1-5', n: 2 } })).result.content[0].text, /^Weekdays at 09:00\. Runs \(.+\): \w{3},? \d+ \w{3}, 09:00, \w{3},? \d+ \w{3}, 09:00$/);
  assert.match((await rpc(4, 'tools/call', { name: 'schedule_preview', arguments: { cron: '*/5 * * * *' } })).result.content[0].text, /^Refused: .*15 minutes/);
  mcp.kill();
  assert.match((await postJ('/api/crew/remove', { name: 'Nim' })).error, /schedule/, 'a nimion with schedules stays');
  // the boss's block: a chat reply makes a schedule; a scheduled boss run cannot
  const bt = await postJ('/api/tasks', { nimion: 'Tork', prompt: 'please schedule a PR digest' });
  const bossJob = await done(bt.id);
  const made = (await get('/api/schedules')).find(s => s.name === 'Fake digest');
  assert.ok(made, 'the boss block made a schedule'); assert.equal(made.by, `Tork (task #${bt.id})`); assert.equal(made.cron, '0 9 * * 1-5');
  assert.ok(bossJob.log.some(e => e.sched === made.id && /Scheduled #/.test(e.t)), 'the chat line carries the schedule for Undo and Pause');
  const bs = await postJ('/api/schedules', { nimion: 'Tork', name: 'Boss again', prompt: 'please schedule more', in: '1h' });
  const count = (await get('/api/schedules')).length;
  await postJ(`/api/schedules/${bs.schedule.id}/run`);
  const bossRun = await until('the scheduled boss run', async () => { const s = (await get('/api/schedules')).find(x => x.id === bs.schedule.id); return s.history[0]?.status === 'done' && s; });
  assert.equal((await get('/api/schedules')).length, count, 'a scheduled run cannot add schedules');
  assert.ok((await get(`/api/tasks/${bossRun.history[0].task}`)).log.some(e => /cannot change schedules/.test(e.t)));
  // restart: a slot that already ran is not run again, and data.json keeps keys this build does not know
  await stopSrv();
  const saved = JSON.parse(fs.readFileSync(path.join(home, 'data.json'), 'utf8'));
  assert.equal(saved.futureKey, 'kept by every build'); assert.equal(fs.existsSync(path.join(home, 'data.json.tmp')), false, 'the tmp file was renamed');
  saved.schedules.find(s => s.id === 1).nextAt = yesterday.getTime(); // as if the server died before saving nextAt
  fs.writeFileSync(path.join(home, 'data.json'), JSON.stringify(saved));
  const before = saved.tasks.length;
  await start();
  await sleep(800);
  const after = await get('/api/schedules');
  assert.ok(after.find(s => s.id === 1).nextAt > Date.now(), 'nextAt fixed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'data.json'), 'utf8')).tasks.length, before, 'no second run for the same slot');
  console.log('integration test passed');
} finally {
  if (srv && srv.exitCode === null) await stopSrv();
  fs.rmSync(tmp, { recursive: true, force: true });
}

// the mission board's groups
{ const T = (id, nimion, status, x = {}) => ({ id, nimion, status, title: 't' + id, created: id * 1000, ...x });
  const gs = HQW.boardGroups([
    T(1, 'Tork', 'done'), T(2, 'Pip', 'done', { parent: 1 }), T(3, 'Nim', 'done', { parent: 1 }),
    T(4, 'Tork', 'done'), T(5, 'Pip', 'needs-you', { parent: 4 }), T(6, 'Dot', 'queued', { parent: 4 }),
    T(7, 'Nim', 'working'), T(8, 'Pip', 'done'),
    T(9, 'Tork', 'done', { schedule: 's1' }), T(10, 'Pip', 'queued', { parent: 9 }),
    T(11, 'Dot', 'done', { parent: 99 }), T(12, 'Tork', 'working'),
  ], 'Tork');
  assert.deepEqual(gs.map(g => [g.key, g.status]), [['job:4', 'needs-you'], ['job:12', 'working'], ['direct', 'working'], ['sched', 'queued'], ['job:99', 'done'], ['job:1', 'done']]);
  const t4 = gs[0]; assert.deepEqual([t4.title, t4.done, t4.total, t4.items.map(t => t.id)], ['t4', 0, 2, [5, 6]], 'steps in plan order, root not counted');
  assert.deepEqual(gs.find(g => g.key === 'job:1').items.map(t => t.id), [2, 3]);
  assert.equal(gs.find(g => g.key === 'job:1').finished, true);
  assert.deepEqual(gs.find(g => g.key === 'direct').items.map(t => t.id), [7, 8], 'open direct jobs first');
  assert.deepEqual(gs.find(g => g.key === 'sched').items.map(t => t.id), [10, 9], 'a scheduled boss run and its step');
  assert.equal(gs.find(g => g.key === 'job:12').total, 0, 'a boss job with no steps yet is still a thread');
  assert.equal(gs.find(g => g.key === 'job:99').title, 'Job #99 (cleared)'); }

// usage: one run from its stream-json result, sums by time, and who used the window
{ const r = runUsage({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }, duration_ms: 3000, num_turns: 2, total_cost_usd: 0.01 }, 5000);
  assert.deepEqual(r, { at: 5000, in: 10, out: 5, cacheR: 100, cacheW: 20, ms: 3000, turns: 2, cost: 0.01 });
  assert.deepEqual(runUsage({ usage: { input_tokens: -3 } }, 1), { at: 1, in: 0, out: 0, cacheR: 0, cacheW: 0, ms: 0, turns: 0 }, 'bad numbers count as 0; no cost when none is reported');
  const tasks = [{ nimion: 'Pip', runs: [r, { ...r, at: 100, cost: undefined }] }, { nimion: 'Nim', runs: [{ ...r, out: 500 }] }, { nimion: 'Dot' }];
  const all = HQW.sumUsage(tasks);
  assert.deepEqual([all.tokens, all.runs, all.jobs, all.ms, all.costRuns, +all.cost.toFixed(2)], [135 * 2 + 630, 3, 2, 9000, 2, 0.02]);
  assert.equal(HQW.sumUsage(tasks, 1000).runs, 2, 'runs before `since` are left out');
  assert.equal(HQW.sumUsage([{ nimion: 'Dot' }]).runs, 0, 'a job with no runs is "not recorded"');
  assert.deepEqual(windowUsage(tasks, 1000).map(x => [x.nimion, x.tokens]), [['Nim', 630], ['Pip', 135]], 'most tokens first, old runs out');
  const st = crewStats([{ nimion: 'Pip', status: 'done', runs: [{ ...r, at: Date.now() }, { ...r, at: Date.now() - 3 * 86400_000 }, { ...r, at: 1 }] }], ['Pip', 'Dot']);
  assert.deepEqual([st.Pip.usage.today.runs, st.Pip.usage.week.runs, st.Pip.usage.all.runs, st.Dot.usage.all.runs], [1, 2, 3, 0]);
  assert.equal(HQW.kfmt(1234), '1.2k'); assert.equal(HQW.kfmt(3456789), '3.5M'); assert.equal(HQW.kfmt(250000), '250k'); }

// deliverables: which files a job made
assert.equal(toolFile({ name: 'Write', input: { file_path: '/w/a.md', content: 'x' } }), '/w/a.md');
assert.equal(toolFile({ name: 'NotebookEdit', input: { notebook_path: '/w/n.ipynb' } }), '/w/n.ipynb');
assert.equal(toolFile({ name: 'Read', input: { file_path: '/w/a.md' } }), null, 'reading is not making');
assert.equal(toolFile({ name: 'Write', input: {} }), null);
assert.deepEqual(mentionedPaths('**Files:**\n- `/Users/x/out/report.html`: the page\n- notes/fruit.md and notes/ and `notes/fruit.md` again\n- Node.js, /health'),
  ['/Users/x/out/report.html', 'notes/fruit.md'], 'files once each; no folders, no prose');
let fl = addFile([], '/w/a.md', 'mentioned', 10);
fl = addFile(fl, '/w/a.md', 'wrote', 5); fl = addFile(fl, '/w/a.md', 'mentioned', 20); fl = addFile(fl, '/w/b.md', 'edited', 30);
assert.deepEqual(fl, [{ path: '/w/a.md', kind: 'wrote', at: 20 }, { path: '/w/b.md', kind: 'edited', at: 30 }], 'one entry per path, strongest kind, latest time');

// the command palette's matching
assert.ok(HQW.fuzzy('nrof', 'NR office') > 0); assert.equal(HQW.fuzzy('xyz', 'NR office'), -1);
assert.equal(HQW.fuzzy('', 'anything'), 0);
assert.ok(HQW.fuzzy('pip', 'Pip') > HQW.fuzzy('pip', 'Plan the pipeline'), 'a whole, short match wins');
assert.ok(HQW.fuzzy('mb', 'Mission board') > HQW.fuzzy('mb', 'Thumbnail'), 'initials beat a match inside a word');
assert.ok(HQW.fuzzy('board', 'Mission board') > HQW.fuzzy('board', 'Bo ard'), 'a whole word wins');
assert.ok(HQW.fuzzy('dark', 'Dark mode') > HQW.fuzzy('dark', 'Draw a rack'), 'a run of letters beats scattered ones');

// nimion colours: the swatches read well on the nimion (vs the overalls and the goggle band) and in the dark room; matching
{ const lum = c => { const v = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(x => (x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  assert.ok(HQW.SWATCHES.length >= 10 && HQW.SWATCHES.length <= 12);
  for (const [name, hex] of HQW.SWATCHES) {
    assert.ok(ratio(hex, '#2f5ea8') >= 2.5, `${name} stands out from the overalls`);
    assert.ok(ratio(hex, '#2b2a2a') >= 5, `${name} vs the goggle band`);
    assert.ok(ratio(hex, '#1c1b23') >= 6, `${name} in the dark room`);
  }
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  for (const [i, [a, x]] of HQW.SWATCHES.entries()) for (const [b, y] of HQW.SWATCHES.slice(i + 1))
    assert.ok(Math.hypot(...rgb(x).map((v, k) => v - rgb(y)[k])) > 40, `${a} and ${b} look different`);
  assert.equal(HQW.swatchName('#FFD84D'), 'Banana'); assert.equal(HQW.swatchName('#123456'), 'custom'); assert.equal(HQW.swatchName(undefined), 'custom');
  assert.ok(HQW.SWATCHES.some(([, hex]) => hex === HQW.TONE), 'the default colour is in the set'); }
// the new props draw in portraits; an unknown prop draws nothing (old crews stay valid)
const bare = s => s.replace(/<path d="M60 16 v-11"[^>]*><ellipse[^>]*><ellipse[^>]*>/, ''); // without the sprout, which a hat hides
for (const prop of ['cap', 'beanie', 'tophat', 'crown', 'glasses', 'sunglasses', 'headphones', 'mug', 'hammer', 'book', 'pencil', 'bowtie'])
  for (const eyes of [1, 2]) assert.ok(bare(HQW.portrait({ prop, eyes })).length > bare(HQW.portrait({ prop: 'none', eyes })).length, `${prop} draws something`);

{ const d = deliverables([{ path: '/w/a.md', kind: 'mentioned', at: 30, task: 4 }, { path: '/w/a.md', kind: 'wrote', at: 10, task: 5 }, { path: '/w/b.md', kind: 'edited', at: 5, task: 6 }], p => p !== '/w/b.md');
  assert.deepEqual(d.map(f => [f.name, f.task, f.at, f.exists, f.by.map(h => h.task)]), [['a.md', 5, 30, true, [5, 4]], ['b.md', 6, 5, false, [6]]], 'one row per file; the writer first; gone files marked'); }

console.log('all tests passed');
