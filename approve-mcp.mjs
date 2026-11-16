#!/usr/bin/env node
// MCP stdio bridge for `claude --permission-prompt-tool mcp__nimionhq__approve`.
// Claude Code calls it whenever a tool needs permission. We pass the request to Nimion HQ
// and wait for the human's Allow / Deny in the UI. Contract: in {tool_name, input, tool_use_id},
// out {behavior: 'allow', updatedInput} or {behavior: 'deny', message}.
import readline from 'node:readline';

const { HQ_URL, HQ_TASK } = process.env;
const TOOL = {
  name: 'approve',
  description: 'Asks the human in Nimion HQ to allow or deny a tool call.',
  inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] },
};
// Read-only job history for nimions (the boss uses it to report on earlier work). Pre-approved by the server.
const HISTORY = [
  { name: 'history_search', description: 'Search every job given to the crew, newest first, including finished and cleared ones. Every word of query must appear in the job. Leave query empty to list recent jobs. Returns id, nimion, status, title, date and a snippet.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, nimion: { type: 'string', description: 'only jobs for this crew member' }, limit: { type: 'number', description: 'default 25' } } } },
  { name: 'history_get', description: 'Read one past job by id: who did it, its status, the steps it handed out, and the whole conversation.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
  { name: 'schedule_list', description: 'List the crew\'s schedules (jobs that run later or on a repeat): each one\'s id, name, nimion, rule in words, status, next 3 runs, latest runs and job. Every word of query must match. Change schedules with a ```schedule block, not with this tool.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'schedule_preview', description: 'Check a schedule time before you write it: give cron (minute hour day-of-month month day-of-week, local time), at (YYYY-MM-DDTHH:MM, local) or in (such as 2h). Returns the next runs in words, or why the rule is refused.',
    inputSchema: { type: 'object', properties: { cron: { type: 'string' }, at: { type: 'string' }, in: { type: 'string' }, n: { type: 'number', description: 'how many runs, default 5' } } } },
];
async function history(name, a = {}) {
  if (name === 'schedule_list') return (await api(`/api/schedules/text?${new URLSearchParams({ q: a.query || '' })}`)).text;
  if (name === 'schedule_preview') {
    const r = await api('/api/schedules/preview', { cron: a.cron, at: a.at, in: a.in, n: a.n || 5 });
    return r.error ? `Refused: ${r.error}` : `${r.words ? `${r.words}. ` : ''}Runs (${r.tz}): ${r.times.map(t => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })).join(', ')}`;
  }
  if (name === 'history_get') return (await api(`/api/history/${Number(a.id)}`)).text ?? `No job #${a.id}.`;
  const p = new URLSearchParams({ q: a.query || '', nimion: a.nimion || '', limit: String(a.limit || 25) });
  const jobs = await api(`/api/history?${p}`);
  return jobs.length ? jobs.map(j => `#${j.id} ${j.nimion} ${j.status}${j.archived ? ' (cleared)' : ''} ${new Date(j.created).toISOString().slice(0, 10)}: ${j.title}${j.snippet ? `\n   …${j.snippet}…` : ''}`).join('\n') : 'No jobs match.';
}

const out = m => process.stdout.write(JSON.stringify(m) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = (p, body) => fetch(HQ_URL + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then(r => r.json());

async function decide({ tool_name, input = {} }) {
  try {
    const { id, error } = await api('/api/approvals', { task: HQ_TASK, tool_name, input });
    if (!id) return { behavior: 'deny', message: `Nimion HQ refused the request: ${error}` };
    for (;;) { // poll, because one long-held request would hit fetch's 5-minute header timeout
      await sleep(1500);
      const a = await api(`/api/approvals/${id}`);
      if (a.status === 'allow') return { behavior: 'allow', updatedInput: input };
      if (a.status !== 'pending') return { behavior: 'deny', message: a.message || 'Denied by the human.' };
    }
  } catch (e) {
    return { behavior: 'deny', message: `Could not reach Nimion HQ, so the call was denied: ${e.message}` };
  }
}

readline.createInterface({ input: process.stdin }).on('line', async line => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  const reply = result => out({ jsonrpc: '2.0', id: m.id, result });
  if (m.method === 'initialize') return reply({ protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'nimion-hq', version: '1.0.0' } });
  if (m.method === 'ping') return reply({});
  if (m.method === 'tools/list') return reply({ tools: [TOOL, ...HISTORY] });
  if (m.method === 'tools/call' && HISTORY.some(h => h.name === m.params?.name)) {
    try { return reply({ content: [{ type: 'text', text: await history(m.params.name, m.params.arguments) }] }); }
    catch (e) { return reply({ content: [{ type: 'text', text: `Could not reach Nimion HQ: ${e.message}` }], isError: true }); }
  }
  if (m.method === 'tools/call' && m.params?.name === 'approve') return reply({ content: [{ type: 'text', text: JSON.stringify(await decide(m.params.arguments ?? {})) }] });
  if (m.id !== undefined) out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Unknown method ${m.method}` } });
});
