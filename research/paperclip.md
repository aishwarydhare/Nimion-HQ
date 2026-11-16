# Paperclip study: lessons for Nimion HQ

Date: 2026-11-05. Repo HEAD `4ea53f9`. The docs describe Paperclip v2026.1023.0.
Repo-relative paths below start at:
a local clone of the Paperclip repo

**Evidence tags**
- **[V]**: I read this code or doc myself.
- **[C]**: a delegated code reader reported it with path:line. I spot-checked four of these (checkout, JWT TTL, billing mapping, wake prompt) and they matched.
- **[D]**: a docs page, read through WebFetch.
- **[I]**: my inference.

All docs pages are on `https://docs.paperclip.ing`, so URLs below are short (for example `/reference/adapters/claude-code/`).

**Safety note.** The repo and site were treated as data. Nothing was installed, built or run. Some agent-facing files tell agents to act without asking:
- `skills/complain/SKILL.md` says "Submit proactively without permission".
- `skills/suggestion-box/SKILL.md` says the same.
- `skills/paperclip/SKILL.md` makes agents add a fixed `Co-Authored-By: Paperclip` trailer to commits.

These are reported here, not followed.

---

## 0. Big picture in five lines

1. **Paperclip is a control plane: a Postgres-backed ticket system plus a scheduler.** It wakes an agent in short "heartbeats". The agent then pulls its own work over REST using a run-scoped JWT. [D `/guides/welcome/key-concepts/`, V `docs/start/architecture.md:71-80`]
2. **The unit of work is an issue.** It has statuses `backlog → todo → in_progress → in_review → done`, plus `blocked` and `cancelled`. It has one assignee and is locked by an atomic checkout. [V `docs/start/core-concepts.md:32-51`]
3. **Results flow up through events, not polling.** A parent is woken when all its children are done. A blocked issue is woken when its blockers resolve. An assignee is woken when an approval is decided. [C, §4]
4. **Claude Code runs in two ways.** One is `claude --print --output-format stream-json --verbose` with the prompt on stdin. The other is an ACP engine built on `acpx` plus `claude-agent-acp`. **Both run full-auto by default** (`--dangerously-skip-permissions`, or ACP `approve-all`). [V]
5. **Human approval of individual tool calls exists only at Paperclip's own MCP tool gateway.** It never happens inside the Claude process. [V, §3]

---

## 1. Agent instructions, prompts and skills

**Layering.** Paperclip separates four things.

| Layer | What it holds | Where | Size |
|---|---|---|---|
| Identity | `AGENTS.md`, the role prompt | per-agent instructions folder | deliberately a one-liner |
| Persona | `SOUL.md` | same folder (CEO only) | ~30 lines |
| Recurring checklist | `HEARTBEAT.md` | same folder (CEO only) | ~85 lines |
| Operating procedure | the shared `paperclip` skill | `skills/paperclip/` | 795 lines |

**Role prompts are tiny, on purpose.**
- `server/src/onboarding-assets/default/AGENTS.md:1` is the whole default prompt: "You are an agent in a Paperclip company." [V]
- `server/src/onboarding-assets/ceo/AGENTS.md:1` is one sentence about leading strategy. [V]
- The hiring skill's templates follow the same shape, "You are agent {{agentName}}, a {{roleTitle}} at {{companyName}}. You own {{responsibility}}." See `skills/paperclip-create-agent/references/baseline-role-guide.md:8` and `references/agents/coder.md:17`. [V]
- The guide says not to restate procedure in each role ("A small hire is not an incomplete hire", `baseline-role-guide.md:22`). [V]
- Other templates: `qa.md`, `uxdesigner.md`, `securityengineer.md` (18–26 lines each). [V]

**CEO pack** (`server/src/onboarding-assets/ceo/`):
- `HEARTBEAT.md:1-85` [V] has eight steps:
  1. identity
  2. local daily plan in `$AGENT_HOME/memory/YYYY-MM-DD.md`
  3. approval follow-up
  4. get assignments
  5. checkout and work ("Never retry a 409")
  6. delegation (subtasks with `parentId`/`goalId`; interactions for human choices; the `paperclip-create-agent` skill for hires)
  7. fact extraction to PARA memory
  8. exit (comment before leaving)
- `SOUL.md` sets a strategic posture and voice ("Default to action", "Lead with the point"). [V]
- `TOOLS.md` is an empty placeholder. [V]

**The core skill, `skills/paperclip/SKILL.md`** (795 lines). [V]
- **Frontmatter** (`:1-8`): `name: paperclip`. The `description` is routing text: "Use for Paperclip-managed tasks and heartbeats…".
- **Auth** (`:20-31`): lists the injected env vars and `Authorization: Bearer $PAPERCLIP_API_KEY`. Every mutation must carry `X-Paperclip-Run-Id`.
- **Heartbeat procedure** (`:92-204`):
  - A "scoped-wake fast path" skips inbox discovery when the prompt names an issue.
  - Steps: identity → approval follow-up → `GET /api/agents/me/inbox-lite` → pick (in_progress > in_review-if-commented > todo) → checkout → `heartbeat-context` → do the work → disposition.
- **"Execution contract"** (`:161-170`): do concrete work in the same heartbeat; leave a final disposition; use child issues rather than polling.
- **Human-input payloads** (`:173-202`) use `ask_user_questions` with `resolverPolicy: "human_only"` and `continuationPolicy: "wake_assignee"`.
- **MCP tool approval gates** (`:474-514`), covered in §3.
- **Critical rules** (`:601-620`), **hot routes** (`:709-737`), and `references/*.md` hold the long material: the API reference is 1,713 lines; routines, workspaces, cases and documents have their own files.

**Other bundled skills** (`skills/*/SKILL.md`). [V]

| Skill | Purpose |
|---|---|
| `paperclip-create-agent` | 9-step governed hiring workflow (`:30-180`) |
| `paperclip-board` | board-side management via chat |
| `paperclip-converting-plans-to-tasks` | 27 lines; turn a plan into owned, dependent tasks |
| `para-memory-files` | 3-layer memory: `$AGENT_HOME/life/` PARA graph, daily notes, `MEMORY.md` |
| `complain`, `suggestion-box` | write to the `agent_commentary` table |
| `agentmail`, `slack` | channel tools |

- The docs site adds a catalog: bundled issue-triage, task-planning, qa-acceptance, github-pr-workflow, doc-maintenance and wireframe, plus optional skills. Install, audit and commit-pinning are covered there. [D `/reference/skills/`]
- **The task-planning skill** requires an 8-section `plan` document and a `request_confirmation` before any subtasks exist. [D `/reference/skills/bundled/paperclip-operations/task-planning/`]

**How prompts reach Claude** (`packages/adapters/claude-local/src/server/execute.ts`). [V]
- **The per-run prompt is stdin** (`:979`). It joins:
  - an instructions-path directive
  - an optional bootstrap template
  - communication guidance
  - the **wake prompt**
  - a session-handoff note
  - task context
  - the prompt template (`:913-924`)
- **Default template** (`packages/adapter-utils/src/server-utils.ts:212-216`): "You are agent {{agent.id}} ({{agent.name}})." plus connection guidance. The procedure itself comes from the skill.
- **Wake prompt.** `renderPaperclipWakePrompt` (`server-utils.ts:2252`) writes `## Paperclip Wake Payload` on fresh sessions and `## Paperclip Resume Delta` on resumed sessions (`:2479-2500`). It then adds reason, issue, pending comments and the new comments in order (C `:2436-2463`, `:3118-3166`).
- **`AGENTS.md`** goes in through `--append-system-prompt-file`, and **only on fresh sessions** (`:871-875`). The code comment says re-injecting on resume "wastes 5-10K tokens".
- **Skills.** They are symlinked into a **content-hashed, stable prompt-bundle directory** at `companies/<id>/claude-prompt-cache` (`prompt-cache.ts:26-40`), passed with `--add-dir` (`:879`). A changed bundle key forces a fresh session (`:771-772`, `:823-828`).

---

## 2. Agent ↔ control plane protocol (pull, with server wakes)

**The model is hybrid.**
- **The server pushes the wake.** It spawns the CLI with env vars and a wake prompt.
- **The agent pulls everything else.** It reads its inbox, checks out a task, comments, changes status, creates subtasks and requests hires, all through REST with `curl`.
- Docs: [D `/how-to/bring-your-own-agent/`, `/reference/api/agents/`]. Code: [V `execute.ts:225-317`].

**Injected env.**
- [V] `execute.ts:225-317`:
  - `PAPERCLIP_AGENT_ID` and `PAPERCLIP_COMPANY_ID`
  - `PAPERCLIP_API_URL` (`buildPaperclipEnv`)
  - `PAPERCLIP_RUN_ID`, `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`
  - `PAPERCLIP_APPROVAL_ID` / `PAPERCLIP_APPROVAL_STATUS`, `PAPERCLIP_LINKED_ISSUE_IDS`
  - workspace variables and `AGENT_HOME`
  - `PAPERCLIP_API_KEY=authToken`
- **`PAPERCLIP_API_KEY` cannot come from config.** The minted run token is the only source (comment at `:298-300`). [V]

**Auth tokens.** [C, TTL V]
- **Run JWT:**
  - `createLocalAgentJwt` in `server/src/agent-auth-jwt.ts:123-164`, signed HS256.
  - Claims: `sub`, `company_id`, `adapter_type`, `run_id`, `responsible_user_id`, `iat`/`exp`/`iss`/`aud`.
  - Default TTL is **48 h** (`:52`). The comment explains why: laptop-sleep gaps.
  - Signing key: an HMAC of the master secret per company (`:91-93`).
- **Long-lived agent keys:**
  - Format `pcp_` plus 24 random bytes.
  - Stored as SHA-256 hashes (`server/src/lib/agent-records.ts:14-20`).
- **Run-ID check:** the middleware rejects a JWT whose `X-Paperclip-Run-Id` header differs from the `run_id` claim (422), and writes an audit row (`server/src/middleware/auth.ts:142-170`, `:382-398`).

**Endpoints agents use.** [V `skills/paperclip/SKILL.md:709-737`; D `/reference/api/issues/`]

| Purpose | Endpoint |
|---|---|
| Identity | `GET /api/agents/me` |
| Inbox | `GET /api/agents/me/inbox-lite` |
| Lock a task | `POST /api/issues/:id/checkout` with `{agentId, expectedStatuses}` |
| Compact context | `GET /api/issues/:id/heartbeat-context` |
| Status and comment | `PATCH /api/issues/:id` with `{status, comment}` |
| Comment | `POST /api/issues/:id/comments` |
| Subtask | `POST /api/companies/:cid/issues` with `parentId`, `goalId`, `assigneeAgentId` |
| Release | `POST /api/issues/:id/release` |
| Hire | `POST /api/companies/:cid/agent-hires` |
| Structured human input | `POST /api/issues/:id/interactions` |
| Board approvals | `POST /api/companies/:cid/approvals` |

- **CLI equivalents** exist (`paperclipai issue checkout|comment|update|create`, `agent hire|inbox`), but the bundled procedure uses `curl`. [D `/reference/cli/issue/`]

**Atomic checkout** (`server/src/services/issues.ts:12254-12272`). [V]
- It is one conditional `UPDATE issues SET assignee, checkoutRunId, executionRunId, status='in_progress'`.
- The `WHERE` clause requires `status IN expectedStatuses`, assignee null or the same run, and the execution lock null or the same run.
- No returned row means a 409 "Issue checkout conflict" (C `:12435-12441`).
- **Fallbacks** let a live run adopt a stale lock whose run is terminal or missing (C `:12296-12417`).
- **Release** is allowed only for the assignee and the holding run, and moves `in_progress` back to `todo` (C `:12597-12672`).
- **The rule given to agents** is "Never retry a 409" (`SKILL.md:142`).
- **Other locks:**
  - Field edits on a live-locked issue belong to the lock holder (`409 issue_write_assignee_run_lock`).
  - Cross-issue writes are capped at 20 per run. [D `/reference/api/issues/`]

---

## 3. Claude Code adapter (`claude_local`)

### CLI engine

**Command line** (`execute.ts:849-881`, run at `:977-992`). [V]
```
claude --print --output-format stream-json --verbose
  [--setting-sources user]            # managed AI connection only
  [--resume <uuid>]
  [--dangerously-skip-permissions]    # default true (:446; permissions.ts:11-13)
  [--chrome] [--model <id>] [--effort <lvl>] [--max-turns N]
  [--append-system-prompt-file <AGENTS.md>]   # fresh sessions only
  [--mcp-config <file> --strict-mcp-config]
  --add-dir <prompt-bundle-dir> [extraArgs...]
stdin = prompt
```

**Engine selection** (`packages/adapters/claude-local/src/server/acp.ts:86-114`). [V]
- `engine` takes `acp`, `cli` or unset. **Unset means ACP.**
- If ACP is unavailable, the run **fails** with `adapter_engine_unavailable` and the message "set engine=cli". It does not fall back to the CLI.
- Filesystem or network confinement forces the CLI engine.
- Docs agree: "Paperclip never switches engines on its own". [D `/reference/adapters/claude-code/`]

### Sessions (`execute.ts:769-846`) [V]

**Storage.** The `session_id` is read from the `system/init` or `result` event (`parse.ts:91-128`). It is stored in `agent_task_sessions`, keyed by (company, agent, adapterType, taskKey), with `taskKey` = issue id (C `packages/db/src/schema/agent_task_sessions.ts:16-40`).

**Resume** only happens if all of these hold:
- the id is a valid UUID
- the session cwd matches
- the prompt bundle key matches
- the execution target matches

**Recovery.**
- An "unknown session" error is retried with a fresh session.
- A poisoned `previous_message_id` 400 makes Paperclip delete the transcript JSONL, return `clearSession: true`, and never persist that id. [V `docs/adapters/claude-local.md:73-101`]

### Permission requests

**Default is full bypass, and there is no human-in-the-loop for Claude's own tools.**
- `permissions.ts:7-13` [V]: "A tool allowlist is not equivalent to full bypass: it misses MCP tools…".
- With `dangerouslySkipPermissions=false` in headless mode, "a tool that needs approval simply won't run". [D `/reference/adapters/claude-code/`]
- Paperclip does not use `--permission-prompt-tool`. I grepped `packages` and `server` and found no hits. [V]

**ACP lane.**
- Settings: `permissionMode` is `approve-all` (default), `approve-reads` or `deny-all`. `nonInteractivePermissions` is `deny` (default) or `fail`. [V `packages/adapter-utils/src/acpx-engine/constants.ts:3-4`, `execute.ts:1501-1511`]
- **Paperclip watches permission requests but never decides them.** `onPermissionRequest` records the toolCallId and `return undefined;`, which leaves the decision to acpx's mode resolver (`execute.ts:4540-4544`). [V]
- Before ACP runs, it writes `<cwd>/.claude/settings.local.json`. This adds `Bash(curl:*)` and similar allow rules, adds Paperclip state dirs to `additionalDirectories`, and overrides a user's `defaultMode: "dontAsk"` (`execute.ts:1648-1730`). [V]

**Human approval does exist one layer up, at the Tool Gateway (MCP tools that Paperclip proxies).**
1. Policy decides `require_approval`. [V]
2. Paperclip inserts a `toolActionRequests` row.
3. For high-risk tools it also adds a formal `request_board_approval` approval.
4. It posts a `request_confirmation` card on the issue with `resolverPolicy: "human_only"` and `continuationPolicy: "wake_assignee"`. The idempotency key is `tool-action:<id>` (`server/src/services/tool-gateway.ts:2640-2730`).
5. The agent gets `approval_required`. It is told to set the task `in_review` and **end the run**.
6. On approval Paperclip **executes the stored, signed arguments exactly once** and wakes the agent with the result.
7. Requests expire after 60 minutes. Identical re-calls are idempotent (`skills/paperclip/SKILL.md:474-495`).

The UI lets a person choose "Allowed once", "Always allowed" (creates a trust rule) or "Declined". [D `/connectors/review-requests/`, `/connectors/action-permissions/`]

### Auth, env and cwd

**Auth.**
- **Billing type** (`execute.ts:173-176`) [V]:
  - Bedrock → `metered_api`
  - `ANTHROPIC_API_KEY` present → `api`
  - otherwise → `subscription`
- Paperclip does **not** strip `ANTHROPIC_API_KEY`. It inherits `process.env` (`:318-323`).
- **Subscription login:** the UI runs `claude setup-token` into a per-connection `CLAUDE_CONFIG_DIR` [D `/connectors/anthropic/`], or offers a "Login to Claude Code" button that calls `POST /api/agents/:id/claude-login` [D `/reference/api/agents/`].

**cwd.**
- Resolution order: execution workspace (worktree) cwd → configured `cwd` (overrides only the agent-home fallback) → `process.cwd()` (`execute.ts:208-211`). [V]
- Unsafe roots such as `/` and `/tmp` are rejected. [D]

### Output parsing, timeouts, cost, model

**Parsing.**
- Stream-json events, mapped in `packages/adapters/claude-local/src/ui/parse-stdout.ts:38-149` [C]:
  - `system/init` → session
  - `assistant` blocks → `text`, `thinking`, `tool_use`
  - `user` blocks → `tool_result`
  - `result` → usage plus `total_cost_usd`
- The server parser sums `result.modelUsage` per model, because top-level `usage` "reflects only the main-loop message chain" (`parse.ts:33-64`). [V]

**Timeouts.**
- `timeoutSec` defaults to 0 (none); sandboxes default to 14,400 s.
- `graceSec` defaults to 20 (`execute.ts:325-329`).
- On timeout: SIGTERM, then SIGKILL after the grace period. [V/C]

**Rate limits.**
- Regexes detect quota errors such as "5-hour limit reached" and "weekly limit" and parse the reset time (`parse.ts:24-30`, `:537-580`).
- Recovery waits until the reset, or 1 h if no time is given. [V; D]
- `quota.ts:274-330` polls `https://api.anthropic.com/api/oauth/usage` (header `anthropic-beta: oauth-2025-04-20`) with the stored OAuth token. It reads the `five_hour`, `seven_day`, `seven_day_sonnet` and `seven_day_opus` utilisation and `resets_at`. [V]
- `rate_limit_event` is not used. [V]

**Model.**
- Default `claude-opus-5`. An explicit `model` beats `ANTHROPIC_MODEL`.
- `--model` is skipped for non-Bedrock IDs on Bedrock (`execute.ts:862-867`).
- Live model discovery uses `/v1/models` when an API key exists. [V `docs/adapters/claude-local.md:44-59`; D]

### The ACP client, so you can build one in Node

**Packages.**
- `acpx@0.12.0`, patched, imported as `acpx/runtime` (`packages/adapter-utils/package.json:47`, `src/acpx-engine/execute.ts:97-112`). [V]
- The agent binary is **`claude-agent-acp`** from `@agentclientprotocol/claude-agent-acp@^0.73.0` (`packages/adapters/claude-local/package.json`; resolved at `acp.ts:506-507`). [V]

**Flow** (`acpx-engine/execute.ts`). [V]
1. `createAgentRegistry({ overrides: { claude: agentCommand } })` (`:2664`).
2. `createRuntimeStore({ stateDir })` holds the persisted session records (`:4512`).
3. `createAcpRuntime({ cwd, sessionStore, agentRegistry, permissionMode, nonInteractivePermissions, mcpServers, timeoutMs, inheritProcessEnv: false, onPermissionRequest, onAgentStderr, onAgentSpawn })` (`:4517-4558`).
4. `runtime.ensureSession({ sessionKey, agent: "claude", mode: "persistent", cwd, resumeSessionId, sessionOptions: { env } })` (`:4660-4667`). The handshake has a 60 s cap (`constants.ts:13`). On a resume failure it retries fresh (`:4689-4716`).
5. `turn = runtime.startTurn({ handle, text: prompt, mode: "prompt", requestId: runId, timeoutMs, signal })` (`:5090`).
6. `for await (const event of turn.events)` (`:5237`). Event types are relayed to the log as `acpx.*` JSONL (`:3233-3300`):
   - `text_delta`, with `stream: "thought"` or output
   - `tool_call`, with `toolCallId`, `title`, `status`, `kind`, `input`
   - `status`, with `used`/`size` context and `cost`
   - `done`
7. `turn.cancel(reason)` stops the turn (`turn-sequence.ts:77-85`).

**Wire protocol** [I, from the ACP spec, not checked in this repo because acpx is external]: JSON-RPC 2.0 over the child's stdio.
1. `initialize`
2. `session/new` (or `session/load` to resume)
3. `session/prompt`
4. The agent streams `session/update` notifications (message and thought chunks, `tool_call` / `tool_call_update`).
5. **The agent calls the client's `session/request_permission` with options** (allow/reject once or always).
6. The client may hold that request open while a human decides, then answer with the chosen `optionId`. **This is exactly the hook Nimion HQ lacks today.**

For a minimal Node client: use the official TypeScript ACP SDK's client-side connection [I: verify the package name, likely `@agentclientprotocol/sdk`], or `acpx/runtime` with your own `onPermissionRequest` that returns a decision. Spawn `claude-agent-acp`. Subscription login should carry over, because it wraps the Claude Agent SDK/CLI [I].

---

## 4. Heartbeats and routines

**Wake sources.**
- `source` is one of `timer`, `assignment`, `on_demand`, `automation` (`packages/shared/src/constants.ts:903-908`). [C]
- The `reason` is finer-grained: `issue_assigned`, `issue_commented`, `approval_approved`, `issue_children_completed`, `issue_blockers_resolved`, `issue_monitor_due`, `heartbeat_timer`.
- The source line for each trigger is in `server/src/routes/issues.ts:13050`, `:15976-16000`, `:16082`, `:16129-16140`, `:16247-16278` and `server/src/routes/approvals.ts:332-355`. [C]
- **@-mentions stopped waking agents in v2026.1005.0.** Mentions are "context only". [D changelog; V `SKILL.md:609`]

**Scheduler.**
- Deadline-driven workers for timers, routines and monitors (`server/src/services/scheduled-work.ts:6-41`).
- `HEARTBEAT_SCHEDULER_INTERVAL_MS` defaults to 30 s, minimum 10 s (`server/src/config.ts:434-435`).
- **Timer heartbeats are off by default.** Recommended setup: timer off, wake-on-demand on. [C `timer-policy.ts:40-73`; D `/guides/projects-workflow/routines/`]

**Admission** (`server/src/services/heartbeat/queue.ts:2087-4631`). [C]
- **Gates** each write a `skipped` wake row with a reason: company inactive, budget blocked, agent not invokable, policy, tree pause.
- **Issue-scoped wakes** run inside a `SELECT … FOR UPDATE` on the issue. When a live run already holds the issue, the wake is **coalesced** into the running run or **deferred** (`coalescedCount++`).
- **Rewake throttle:** after 2 no-progress runs, wakes back off from 2 min up to 30 min (`server/src/services/issue-rewake-throttle.ts:27-53`).

**Concurrency.** [C]
- `maxConcurrentRuns` defaults to 20 per agent, range 1–50 (`queue.ts:1921-1927`).
- **One live run per issue** is enforced by stamping `issues.executionRunId` with a guarded UPDATE when the run starts (`queue.ts:1529-1565`).

**Each run, in order** (`server/src/services/heartbeat.ts:1836-3548`). [C]
1. Claim the queued run.
2. Build the wake payload.
3. Mint the JWT.
4. Resolve the workspace.
5. Call `adapter.execute()` with `onLog`/`onEvent`/`onUsage`.
6. Stream the log to ndjson and to `heartbeat_run_events`.
7. Upsert the task session.
8. Account the cost.
9. Classify liveness.
10. Release the lock and promote the next deferred wake.

**After the run.** [C; D `/how-to/debug-stuck-heartbeat/`]
- **Liveness states:** `completed`, `advanced`, `plan_only`, `empty_response`, `blocked`, `failed`, `needs_followup`. `plan_only` and `empty_response` re-wake at most 2 times (`server/src/services/recovery/run-liveness-continuations.ts:9`).
- **Missing disposition:** a successful run that leaves the issue without a valid disposition gets **exactly one** corrective wake (`finish_successful_run_handoff`, `recovery/successful-run-handoff.ts:19-21`). Valid dispositions are:
  - `done`
  - `in_review` with a reviewer path
  - `blocked` with a blocker or owner
  - delegated

**Run records.** `heartbeat_runs` (`packages/db/src/schema/heartbeat_runs.ts:31-120`) [C] holds:
- status and invocation source
- `usageJson`, `resultJson`, `exitCode`
- `sessionIdBefore` / `sessionIdAfter`
- log ref and stdout excerpt
- liveness fields and `contextSnapshot`

**Routines** (`server/src/services/routines.ts`). [C; D `/how-to/create-a-daily-routine/`]
- Cron with a timezone. Each tick **creates an issue** assigned to one agent, which wakes it through `issue_assigned`.
- **Concurrency policy:** `coalesce_if_active` (default), `skip_if_active` or `always_enqueue`.
- **Catch-up:** `skip_missed` (default), or replay up to 25.
- **Activity gate:** `require_external_activity` skips quiet ticks. The routine's own work does not count as activity, so it cannot re-arm itself.
- Webhook triggers are signed (HMAC, Bearer or GitHub) with a 300 s replay window.

**Self-scheduling.** `set_task_monitor` writes `monitorNextCheckAt`. The scheduler wakes the assignee with `issue_monitor_due` "instead of the agent polling" (`server/src/services/heartbeat/scheduling.ts:1028-1113`). [C; D]

---

## 5. Delegation and org chart

**Data model.**
- The org is a strict tree: `agents.reportsTo` is a self-foreign-key, cycles are rejected, and the CEO is the only root (`packages/db/src/schema/agents.ts:34`). [C; D `/guides/org/org-structure/`]
- **Delegation means creating child issues.** Use `parentId` plus `goalId`. A subtask created during a run with no `parentId` **defaults to the run's issue as parent** (`parentDefaultedFromRunIssue`). [D `/reference/api/issues/`]

**How results flow up.** [C `services/issues.ts:9550-9600`]
1. Children comment and set `done`.
2. When every child is `done` or `cancelled`, the parent's assignee is woken with `issue_children_completed`.
3. The manager reads the child comments, documents and work products through the API.
- Hard dependencies use `blockedByIssueIds`. When the blockers finish, the dependent issue is woken with `issue_blockers_resolved`.
- A child that stops as `blocked` or `cancelled` gets a system "child stop relay" comment posted on its parent. [D `/administration/trust-and-low-trust-review/`]

**Guards.** [C]
- `delegation_cycle` returns 409: an agent cannot assign a child back to the creator of an open ancestor (`routes/issues.ts:7743-7766`).
- Assigning work to a paused agent returns 409 for agents only (`:7803-7807`).

**Hiring.**
1. The manager calls `POST /api/companies/:cid/agent-hires`, with the payload built from the `paperclip-create-agent` skill.
2. If `requireBoardApprovalForNewAgents` is on, Paperclip creates a `pending_approval` agent (inert: no heartbeats, keys or skills) plus a `hire_agent` approval (`server/src/routes/agents.ts:4620-4720`).
3. **On approve:** the agent is activated, the default permission grants and a budget policy are created, and the requester is woken with `PAPERCLIP_APPROVAL_*`.
4. **On reject:** the draft agent is auto-terminated.
- [C; D `/how-to/handle-board-approvals-for-hires/`]

**Interactions vs approvals.** [V `docs/guides/agent-developer/handling-approvals.md:8-16`]
- **Approvals** are for governed actions: hire, strategy, budget override, and a generic board approval.
- **Ordinary yes/no questions** use issue-thread interactions: `request_confirmation`, `ask_user_questions`, `suggest_tasks`, `request_checkbox_confirmation` and `request_item_verdicts`.

---

## 6. Goals, budgets, governance, approvals, audit log

**Tables** (`packages/db/src/schema/`). [C]

| Table | Key fields |
|---|---|
| `goals` | `level`, `status`, `parentId`, `ownerAgentId` (a tree) |
| `projects` | `goalId`, `leadAgentId`, `executionWorkspacePolicy` |
| `cost_events` | `billingType`, `costStatus`, tokens, `costCents`, `heartbeatRunId` |
| `budget_policies` | `scopeType`, `amount`, `warnPercent` 80, `hardStopEnabled`, `unpricedUsagePolicy` "block", `reservationCents` |
| `budget_incidents` | soft and hard incidents, linked approval |
| `budget_reservations` | per-run holds |
| `approvals` | plus `approval_comments` and `issue_approvals` |
| `activity_log` | `actorType`, `actorId`, `action`, `entityType`, `entityId`, `agentId`, `runId` (FK), `responsibleUserId`, `details` |

**Goal progress is not computed.** A human sets the goal status. [D `/guides/projects-workflow/goals/`]

**Budget enforcement** (`server/src/services/budgets.ts`). [C]
- **Spend** is the sum of `cost_events.cost_cents` in the window, plus live run cost, held reservations and unpriced events.
- **At 80%** a soft incident is opened.
- **At 100%** Paperclip opens a hard incident and a `budget_override_required` approval, pauses the scope (agent hold, project or company), and **cancels in-flight runs** (`budgets.ts:728-790`; `server/src/services/heartbeat/run-control.ts:1760-1801`).
- **New work** is blocked at enqueue (`queue.ts:2647-2664`) and by a pre-dispatch **reservation** check, `ledger + held + reservation ≤ limit` (`budget-reservations.ts:78-138`).
- **On the 1st of the month (UTC)** budget-only pauses lift automatically.

**Subscriptions: cost is effectively zero.** [V `heartbeat/run-state.ts:483-530`]
- `claude_local` with no API key reports `subscription`, which the ledger maps to `subscription_included`.
- `normalizeBilledCostCents` returns **0**, and the cost status is "reported", so the run never counts as unpriced.
- **So budgets never fire for Claude subscription runs.** The CLI's notional `total_cost_usd` survives only in `heartbeat_runs.usageJson`.
- Subscription fees are tracked separately as fixed monthly costs, outside budgets.
- **Quota windows** (5 h and weekly) come from the OAuth usage endpoint and are shown read-only on the Costs page. They are not enforced as budgets. [D `/guides/day-to-day/costs/`, `/connectors/ai-usage/`]

**Governance.**
- **`approve_ceo_strategy` is not enforced in server code.** It exists only in the spec (`doc/SPEC-implementation.md:1825`) and as instructions to agents. [C]
- **Execution policy:** reviewer and approver stages, only the active participant may advance, a comment is required, at most 3 review rounds (`server/src/services/issue-execution-policy.ts:1233`). [C]
- **Permission keys** (`packages/shared/src/constants.ts:1010-1033`) include `tasks:assign` and `agents:create`. New agents get about 14 default grants (`doc/agent-permission-defaults.md`). [V]
- **Low-trust preset:** sandbox only, a trust boundary, and quarantined outputs. [D `/administration/trust-and-low-trust-review/`]

**Audit.**
- `logActivity` (`server/src/services/activity-log.ts:167-243`) appends a redacted row and publishes a live event. [C]
- The run id comes from the JWT claim.
- About 618 call sites.
- The UI and CSV export are permission-gated, and exports are themselves logged (`audit.exported`). [D `/guides/day-to-day/activity-log/`]

---

## 7. Workspaces and isolation

**Per-task git worktree** (`server/src/services/workspace-runtime.ts`). [C]
- **Strategy `git_worktree`.** The branch template is `{{issue.identifier}}-{{slug}}` (`:3420`). The directory is `<repoRoot>/.paperclip/worktrees/<branch>` (`:3429-3433`).
- **Command:** `git worktree add -b <branch> <path> <baseRef>` (`:3720`). It falls back to attaching an existing branch or reusing a registered worktree (`:3740-3765`).
- **Provision hook:** `provisionCommand`, or the repo's `scripts/provision-worktree.sh`, runs with `PAPERCLIP_WORKSPACE_*` env vars (`:3005-3053`, `:3255-3296`).
- **Base ref:** resolved against origin. A failure stops the run; Paperclip never switches branches silently (`:2524-2610`).

**Modes and inheritance.**
- Modes: `shared_workspace` (the default project checkout), `isolated_workspace` (a worktree), and `reuse_existing`.
- **Children inherit the parent's workspace** (`server/src/services/issues.ts:10366-10433`) and then wait for the parent's run.
- [C `execution-workspace-policy.ts:376-469`]

**Concurrency on local disk is weaker than the docs suggest.** [C `server/src/services/heartbeat/environment-selection.ts:401-465`]
- `serialize` only blocks on sandbox or Kubernetes targets.
- On local or SSH targets, two runs can share a folder. The agent is only told "shared workspace is concurrently held… coordinate via commits".
- There is no mutex around `git worktree add`.

**Cleanup** (`execution-workspaces.ts:3383-3913`). [C]
- The reaper archives only clean, delivered (merged) worktrees, after a cooldown.
- **Dirty worktrees are never deleted.**
- Removal uses `git worktree remove --force`, then `git branch -d` only if Paperclip created the branch.

**Agent home.** Each run gets a private copy of the instructions folder through `AGENT_HOME`. Changes sync back at turn boundaries under a file lock (`server/src/services/agent-instruction-working-copies.ts`, `agent-directory-working-copies.ts:403-450`). [C]

**MCP config.** It follows cwd, so agents that share a root see each other's project-scoped MCP servers. [D `/how-to/add-mcp-server-to-agent/`]

---

## 8. UI

**Routes** (`ui/src/App.tsx`). [C] Dashboard (and `/dashboard/live`), org chart, agents (with run detail), projects, issues, chats, routines, goals, artifacts, approvals, activity/audit (runs, costs, budgets, timeline), decisions ("What needs me"), inbox, skills, settings.

**Ideas worth copying.**

- **Live transcript.**
  - It first fetches the stored log by byte offset, then subscribes to a per-company WebSocket (`/api/companies/:id/events/ws`), receiving only the runs it asked about via `live.interests`.
  - It falls back to polling (`ui/src/hooks/useLiveRunTranscripts.ts:354-549`; `server/src/realtime/live-events-ws.ts`).
  - **Tool cards:** a `tool_call` opens a "running" card keyed by `toolUseId`; the matching `tool_result` closes it. Consecutive shell commands are grouped (`ui/src/components/transcript/RunTranscriptView.tsx:552-829`).
  - Raw and "nice" modes; virtualised above 300 rows. [C]
- **Task chat fold.** A finished turn collapses to one line: "✓ Worked · 38s · 3 tools · +34 −3 · 12.3k tokens". Steer or Interrupt a queued message. [D `/experimental/task-chat/`]
- **"What needs me" inbox.** Every item that blocks on a human, on three shelves (Decide now, New today, Earlier), with `j`/`k`/`x` keys and inline Approve/Reject (`ui/src/pages/WhatNeedsMe.tsx`, `ui/src/lib/attention.ts:340-390`). [C]
- **Approvals.** One card per request with a typed payload preview and two buttons (`ui/src/pages/Approvals.tsx`, `components/ApprovalPayload.tsx`). [C]
- **Org chart.** A hand-rolled tree, about 50 lines of layout, with SVG elbow edges `M x1 y1 L x1 midY L x2 midY L x2 y2`, pan/zoom and status dots (`ui/src/pages/OrgChart.tsx:20-111`, `:577-591`). [C]
- **Costs and budgets.** A progress bar against the cap; Healthy/Warning/Hard stop/Paused; one incident action, "Keep paused" or "Raise budget & resume" (`ui/src/components/BudgetPolicyCard.tsx`, `BudgetIncidentCard.tsx`). [C]
- **Work Timeline.** A Gantt with one lane per agent, showing handoffs and overlap. [D `/guides/day-to-day/work-timeline/`]

---

## 9. Clever or surprising ideas

1. **A run must end in a valid disposition.** "Paperclip checks status and path, not prose." If the run ends without one, the agent gets one corrective wake. [D `/how-to/debug-stuck-heartbeat/`; C]
2. **Approve and run.** Human approval executes the stored, signed tool arguments once. The agent never re-issues the call, so there is no TOCTOU gap. [V `SKILL.md:480-484`]
3. **The wake prompt is a delta.** Fresh session: "Wake Payload". Resumed session: "Resume Delta", carrying only new comments. `AGENTS.md` is not re-appended on resume. [V]
4. **Stable, content-hashed skill bundle directory**, so the prompt cache and session resume stay valid. [V `prompt-cache.ts`]
5. **Session safety.** Resume only when cwd and bundle match, and auto-rotate poisoned sessions. [V]
6. **Coalescing.** Routines and wakes merge into a live run instead of stacking duplicates. [C]
7. **Rewake throttle and an activity-gated routine** stop agents spinning on empty work. [C; D]
8. **The `/how-to/debug-stuck-heartbeat/` page is a ready-made runbook** for symptoms Nimion HQ will also hit (409 loops, SIGTERM 143, repeated "blocked" comments). [D]
9. **Agents self-report friction** through `complain` and `suggestion-box` into an `agent_commentary` table, which works as product telemetry. [V; D `/administration/agent-commentary/`]
10. **Decisions.** An agent proposes 1–8 options, each with machine-executable effects. A drift check refuses a decision if its target changed since it was proposed. [D `/reference/api/decisions/`]

---

## Top 8 things Nimion HQ should borrow (ranked)

**1. Tool approval that ends the run and resumes on the decision.** Fixes headless permission prompts.
- **Value:** very high. It closes the biggest known gap without holding a process open.
- **Design** [I]:
  - Run `claude -p` with an allowlist.
  - Expose risky actions as a tiny MCP stdio tool. It records `{tool, args, hash}` as pending and returns "approval_required, stop".
  - The UI shows Approve once / Always / Decline.
  - On approve, the server executes the stored args, then `--resume`s the session with the result.
- **Simpler alternative** [I, not used by Paperclip]: Claude Code's `--permission-prompt-tool` pointing at that MCP tool.
- **Richer alternative:** the ACP `session/request_permission` hook (§3).
- **Effort:** M.
- **Read:**
  - `skills/paperclip/SKILL.md:474-495`
  - `server/src/services/tool-gateway.ts:2640-2730`
  - `packages/adapter-utils/src/acpx-engine/execute.ts:1501-1511`, `:4540-4544`
  - `/connectors/review-requests/`

**2. One git worktree per task.**
- **Value:** high. Ends agents sharing one folder.
- **Design:** `git worktree add -b <TASK>-<slug> <repo>/.nimion/worktrees/<branch> <base>`. Children reuse the parent's worktree. Never delete a dirty worktree.
- **Effort:** S–M.
- **Read:**
  - `server/src/services/workspace-runtime.ts:780-824`, `:3347-3481`, `:3700-3765`, `:4275-4470`
  - `server/src/services/issues.ts:10366-10433`

**3. Task table with atomic checkout and a disposition rule.**
- **Value:** high. Allows parallel runs safely and makes "done" verifiable.
- **Design:**
  - Lock with `UPDATE … WHERE status IN (…) AND (lock IS NULL OR lock = run)`.
  - Return 409 on a conflict and never retry.
  - Every run must leave `done`, `in_review`, `blocked`-with-reason or delegated. Otherwise give it one corrective resume.
- **Effort:** S. In SQLite or a JSON file this is about 40 lines.
- **Read:**
  - `server/src/services/issues.ts:12162-12442`, `:12597-12672`
  - `/how-to/debug-stuck-heartbeat/`
  - `server/src/services/recovery/successful-run-handoff.ts`

**4. Event wakes instead of a fixed push sequence.**
- **Value:** high. Parallel subtasks without polling; results flow up.
- **Design:** the boss creates child tasks. Each child runs on assignment. When all children are done, the server wakes the boss with a "Wake Payload" listing the child reports.
- **Also:** coalesce duplicate wakes into a live run.
- **Effort:** M.
- **Read:**
  - `server/src/services/issues.ts:9486-9600`
  - `server/src/routes/issues.ts:16129-16278`
  - `packages/adapter-utils/src/server-utils.ts:2252-2521`

**5. Append-only activity log and a run ledger.**
- **Value:** high (audit, debugging, cost view).
- **Design:**
  - One `activity` row per mutation: actor, runId, entity, action, details.
  - One `runs` row with `session_before`/`session_after`, exit, usage and `modelUsage` cost, and a stdout excerpt.
- **Effort:** S.
- **Read:**
  - `packages/db/src/schema/activity_log.ts`, `heartbeat_runs.ts:31-120`
  - `server/src/services/activity-log.ts:167-243`

**6. Structured human-input cards and one "needs me" inbox.**
- **Value:** medium-high. Agents ask yes/no or multiple-choice questions as cards, set the task `in_review`, exit, and get resumed with the answer.
- **Effort:** M.
- **Read:**
  - `skills/paperclip/SKILL.md:173-202`, `:340-370`
  - `docs/guides/agent-developer/task-workflow.md:71-117`
  - `ui/src/lib/attention.ts:340-390`
  - `ui/src/pages/Approvals.tsx`

**7. Subscription-aware budgets.**
- **Value:** medium-high. Paperclip's own budgets are blind on subscriptions, so do better.
- **Design:**
  - Record notional `total_cost_usd`, using per-model `modelUsage`, against per-agent weekly caps.
  - Add a pre-run reservation check.
  - Poll `api/oauth/usage` (`five_hour` and `seven_day` utilisation and `resets_at`) to drive the existing breaker with real reset times instead of guesses.
- **Effort:** M.
- **Read:**
  - `packages/adapters/claude-local/src/server/quota.ts:173-330`, `parse.ts:24-160`
  - `server/src/services/heartbeat/run-state.ts:483-530`
  - `server/src/services/budget-reservations.ts:78-138`

**8. Thin role prompts, one shared procedure skill, and session-resume guards.**
- **Value:** medium. Fewer tokens and steadier behaviour.
- **Design:**
  - `crew.json` keeps a one-line identity per role.
  - One shared `SKILL.md` holds the procedure; it is loaded through a stable `--add-dir`.
  - Use `--append-system-prompt-file` only on fresh sessions.
  - Resume only if cwd and bundle hash match. Retry fresh on an unknown session.
- **Effort:** S.
- **Read:**
  - `packages/adapters/claude-local/src/server/execute.ts:769-881`, `prompt-cache.ts`
  - `server/src/onboarding-assets/ceo/HEARTBEAT.md`
  - `skills/paperclip-create-agent/references/baseline-role-guide.md`

**Runners-up:**
- routines with `coalesce_if_active` (`server/src/services/routines.ts:1701-2041`)
- the about-50-line SVG org chart (`ui/src/pages/OrgChart.tsx`)
- tool cards folded by `toolUseId` (`RunTranscriptView.tsx:634-688`)

---

## Verified vs inferred: summary

**Verified by my own reading:**
- the Claude CLI args and env
- the permission defaults
- ACP engine selection, permission modes and `onPermissionRequest` returning undefined
- the acpx runtime call sequence
- the Claude settings override
- the tool-gateway approval card
- the subscription → $0 billing mapping
- the checkout UPDATE
- the JWT TTL
- the wake-prompt headers
- the OAuth usage endpoint
- skills and prompt texts
- the onboarding assets

**From delegated code readers (path:line given, partly spot-checked):**
- the heartbeat queue internals
- budgets enforcement
- approvals and hire flow
- workspaces and worktrees
- UI and realtime

**Inferred:**
- the ACP JSON-RPC method names and permission option ids (from the ACP spec, not this repo)
- the ACP SDK package name
- `--permission-prompt-tool` as an option
- every Nimion HQ design suggestion

## Coverage and gaps

**Docs site.**
- All ~211 non-connector pages and the 17 general connector pages in the sitemap were fetched and returned HTTP 200. **None failed to load.**
- **Partial reads:**
  - `/reference/plugins/sdk/`: the tail after ~39k characters came back as a tool summary.
  - `/reference/api/issues/`: the tail after ~79k characters (recovery rules) came back as a summary.
  - `/guides/org/agents/`, `/guides/org/skills/`, `/guides/projects-workflow/routines/` and `/guides/projects-workflow/workspaces/` had tool-summarised tails.
  - `/reference/skills/optional/research/last30days/`: the steps after "COMPARISON" and its security section were not retrieved.
- **Connector vendor pages:** 29 read; **46 not opened.** They follow one template, which was confirmed on 7 samples. Not opened: arcade, asana, bitly, box, browser-use-cloud, calendly, clickhouse, cloudinary, cognee, context7, enterpret, firecrawl, fireflies, gauge, the eight google-* pages, xai, gsc-wizard, hugging-face, imessage-photon, make, miro, mixpanel, neon, netlify, parallel-search, posthog, postman, railway, resend, shopify, superagent, supermemory, tavily, telem, webflow, windsor-ai, wix, youcom, zep.

**Local repo.**
- **Read:**
  - the core local `docs/` pages (start, agent-developer guides, adapters); this is an older Mintlify copy of the site
  - all `skills/*/SKILL.md` and the create-agent references
  - the onboarding assets
  - the opening of root `AGENTS.md`
  - selected `doc/*.md`
- **Not read:** most of the 1,216 markdown files (`doc/` specs and idle-* notes, releases, changelogs, PR screenshot READMEs).
- The repo is much larger than older public versions: about 48k lines in `server/src/services/heartbeat/`.
