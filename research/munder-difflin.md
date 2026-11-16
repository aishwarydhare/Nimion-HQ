# Munder Difflin: what it does and what Nimion HQ should borrow

Studied on 2026-11-05. The repo was cloned at commit `83acdc1` (3 Nov 2026), and the site was read at https://munderdiffl.in/.
All paths below are relative to the repo root
(`.../scratchpad/repos/munder-difflin`). Line numbers refer to that commit.

**Labels used:** **[V]** means verified in code or docs. **[D]** means it is only stated in docs, the website or the blog. **[I]** means it is my own inference.

---

## 0. What the repo contains

- **The public repo holds the Classic (free) source only, and that source is frozen at v0.4.6.** [V]
  - `package.json` says `"version": "0.4.6"`, and so does tag `v0.5.5`. I checked with `gh api .../contents/package.json?ref=v0.5.5`.
  - `CHANGELOG.md` stops at `[Unreleased]` after 0.4.6 (27 Aug 2026).
  - The README (lines 325-358) describes v0.5.6 features that are not in `src/`: Stapler, Temps, `handoff.md`, "Token limits per period", per-floor folders and licences. A grep for `stapler|licen[cs]e key|handoff.md|temps` in `src` finds nothing.
  - The repo now redirects to `HarnessMD/munder-difflin`.
- **Pro is closed and paid.** [D] It costs $20 for 30 days or $150 for 365 days (`docs/pricing.html`). Pro adds the sidebar workspace, Stapler, Capabilities, Integrations and agent files. `RELEASE.md:40-46` says Pro "stays ahead of Community".
- **What is open is still large.** It is about 29k lines in `src/main` and `src/shared`, plus the renderer. Everything below about mechanisms comes from that open code.

---

## 1. How it drives the agent CLIs

**It runs a real interactive PTY. It does not use headless print mode and does not use ACP.** [V]

- **Spawning.**
  - `src/main/pty.ts` spawns each agent with `node-pty`.
  - The renderer shows the output with xterm.js (`src/renderer/src/components/terminalPool.ts`, `PtyTerminalView.tsx`).
  - Output streams to the window that owns the agent over IPC `pty:data:<id>` (pty.ts:56-61).
  - The original `SPEC.md` planned tmux (`pipe-pane` and `send-keys`, SPEC.md:51-55). The code replaced tmux with node-pty.
- **The Claude Code command line.** It is built from three places: the preset in `src/shared/agentProvider.ts:170-195`, `HiveManager.ensureAgent` in `src/main/hive.ts:994-1004`, and `spawnAgentCore` in `src/main/index.ts:2818-2886`. The result looks like this:

  ```
  claude --permission-mode bypassPermissions        # only when autoMode is on (default true, config.ts:427)
         --model <m>                                # per-agent, then defaultModel, then role default
         --append-system-prompt "<identity + HIVE PROTOCOL, ~6k chars>"
         --settings <hive>/agents/<id>/settings.json   # hooks + statusLine + sandbox + MCP
         --remote-control-session-name-prefix <AgentName>
         [--max-turns N]  [--resume <session_id>]
  ```

  The child also gets these environment variables: `AGENT_ID`, `AGENT_NAME`, `HIVE_ROOT`, `AGENT_DIR` and `HIVE_SOCK`. It gets OTel variables that point at a local OTLP collector (hive.ts:978-990). When enabled, it also gets `MEMPALACE_PALACE_PATH`.
- **Other CLIs.**
  - Each CLI has a preset with these fields: `autoModeFlag`, `modelFlag`, `resumeFlag` or `resumeSubcommand`, `initialPromptFlag` or `positionalInitialPrompt`, and `seedDelivery: 'type-into-tui'` (agentProvider.ts:62-168).
  - Codex runs with `-a never -s workspace-write` and takes the protocol as a positional prompt.
  - Gemini and agy take it via `-i`, and OpenCode via `--prompt`.
  - Copilot is the one CLI driven in print mode (`-p`). It has `canReceiveInbox:false`.
- **Sending prompts in.**
  - `submitToPty` (`src/renderer/src/hooks/useHive.ts:129-160`) writes the text first. Multi-line text is wrapped in bracketed paste, `ESC[200~…ESC[201~`. It waits 140 ms and then sends `\r` as a separate write. Sending them together makes the TUI treat the `\r` as a pasted newline.
  - Writes to one PTY go through a promise chain, so two writers never interleave (useHive.ts:84-88).
  - All automatic input goes through a single drain loop (effect #4, useHive.ts:778). The contract is in `docs/message-queue.md`. A message is delivered only when all of these hold:
    - the agent is idle;
    - the boot grace (35 s) has passed;
    - the user has no draft on the prompt line;
    - no slash-command picker is open;
    - at least 4.5 s have passed since the last delivery.
  - Draft detection reads xterm's rendered prompt line. That read is only allowed to clear a draft flag, never to set one (message-queue.md §4).
- **Reading state out.** There are two planes, combined.
  1. **Hooks (the authoritative source).**
     - Per-session `--settings` routes `Stop`, `SubagentStop`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `SessionStart`, `PreCompact` and `PostCompact` to a small Node shim (hive.ts:1294-1306).
     - The shim is `HOOK_SHIM` at hive.ts:3111. It pipes the payload to a Unix socket owned by `HookServer` in `src/main/hooks.ts`.
     - A `statusLine` command (hive.ts:1277) sends `context_window.total_input_tokens` and `context_window_size` after every response. That drives an exact context gauge (hooks.ts:401-416).
  2. **PTY scraping (a fallback).** `src/renderer/src/hooks/usePtyParser.ts`:
     - busy = the footer text "esc to interrupt" is on screen;
     - tool = the line `● Read foo`;
     - waiting = one of `Do you want to proceed`, `❯ 1. Yes` or `(y/n)` is on screen (lines 29-35);
     - idle = 4 s without a tool line.
- **How each state is detected** (useHive.ts:477-560):

  | State | Signal |
  |---|---|
  | busy | `PreToolUse`, `PostToolUse` or `UserPromptSubmit` |
  | idle / done | `Stop` |
  | needs a human | a `Notification` whose message contains "permission", "approve" or "confirm" and is not "waiting for your input". Only the orchestrator shows `blocked`; workers show `waiting`. |
  | compacting | `PreCompact` |
  | looping | the breaker level overrides everything else |

  A fallback for all CLIs flips an agent to idle after 12 s with no PTY output (useHive.ts:43). A watchdog in the main process does the same for workers (`src/main/workerWake.ts`).
- **One-shot "hidden" Claude calls** (`src/main/hiddenClaude.ts`). These are used for memory condensation. They also use an interactive PTY rather than `claude -p`. The steps are:
  - wait for the boot output to go quiet;
  - bracketed-paste the prompt;
  - wait 3.5 s of quiet;
  - read the last assistant text from the transcript JSONL;
  - kill the session.

  The stated reason is quota: "so calls draw from the user's normal interactive plan quota, not the Agent SDK credit" (lines 16-18). [V in code]

  That announced billing change was paused. The Anthropic help article (fetched today) says that as of 15 Jun and 7 Oct 2026, "`claude -p` … still draw from your subscription limits". [V, web] This matches the update to `docs/blog/does-the-june-2026-agent-sdk-change-affect-munder-difflin/`. **Nimion HQ's `-p` approach is fine today, but it is the policy-exposed path.**

## 2. Permissions

**The default is skip-permissions plus an OS sandbox. A human approves natively in the terminal or from a phone. There is no approval UI for workers.** [V]

- **Auto mode.** `autoMode: true` is the default (config.ts:427), which adds `--permission-mode bypassPermissions`. Before each spawn, `ensureClaudePermissionsAccepted` (config.ts:850-885, called at index.ts:2955) writes two things:
  - `skipDangerousModePermissionPrompt` and `skipAutoPermissionPrompt` into `~/.claude/settings.json`;
  - `projects[cwd].hasTrustDialogAccepted` into `~/.claude.json`.

  Without these, the bypass warning and the folder-trust dialog stall the PTY.
- **The sandbox replaces prompts.** The per-session settings file adds `sandbox: {enabled:true, filesystem:{allowWrite:[agentDir, hiveRoot, …]}}` and `permissions.additionalDirectories` (hive.ts:1279-1293). The comment says:
  - both are needed: the first covers Bash children, the second covers Edit/Write;
  - with only one, the agent deadlocks on its own inbox;
  - it was verified live on claude 2.1.239 that `touch $HOME/x` fails.

  Codex keeps its own sandbox through `-s workspace-write` (agentProvider.ts:201-214).
- **Operator gates that work through hook return values, not keystrokes** (`src/main/control.ts`, used at hooks.ts:424-545):
  - **Pause, or gate a tool:** `PreToolUse` returns `permissionDecision:'deny'`.
  - **Halt:** the next hook returns `{continue:false, stopReason}`, which is a clean stop.
  - **Steer:** the next `UserPromptSubmit` or `PostToolUse` returns `additionalContext`, delivered once.
- **When auto mode is off.** Claude's own prompt shows in the terminal. For the orchestrator, the PTY parser raises a banner whose Approve and Deny buttons type `y\r` and `n\r` (usePtyParser.ts:155-168). The docs point to `/remote-control` for phone approval (HIVE.md §2.3).

## 3. Orchestrator and agent prompts

Every Claude agent gets one `--append-system-prompt` block (`injectedPrompt`, hive.ts:1530-1609). It is kept "volatile-free" so the prompt cache stays warm: no dates, ids or board state (hive.ts:1509-1520). Anything that changes goes in through hooks or the inbox.

- **Every agent** gets a header line: *You are "Name" (id), an autonomous agent in a collaborating hive*. Then come 4 protocol rules:
  1. at the start of a task, read `memory.md` and every file in `inbox/`, and move handled files to `inbox/.done`;
  2. append durable facts to `memory.md`;
  3. send messages by writing one JSON file into your own `outbox/` and never into another agent's folder;
  4. at the end of a task, append what you learned.

  It also gets a guardrails line about breaker messages, a Slack reply rule, a `ctx NN%` routing hint, and a list of environment variables.
- **The orchestrator ("Michael")** gets `godLine` (hive.ts:1585-1587):
  - *"ORCHESTRATE, not implement."*
  - Check the live roster before spawning, and route to a named agent when the human names one.
  - Own only decomposition, sign-offs, conflicts, integration and QA.
  - Be the sole writer of `board.md`.
  - Dispatch every task as a **4-part contract: OBJECTIVE, OUTPUT, TOOLS, BOUNDARIES**, and pass references, not pasted content.
  - Read `fleet.json` on each heartbeat.
  - Always set a task's `assignee` and never clear it.
  - Ask the human by setting a card to `blocked` and adding to `humanQA` (see §4).
  - If spawning is allowed, it gets a `spawn-requests/<id>.json` recipe (hive.ts:1582). That setting is off by default.
- **First message to the orchestrator.** On first boot the renderer types `INITIAL_GOD_PROMPT` (useHive.ts:75-82): read memory and inbox, read board and tasks, read fleet.json and COMMANDS.md, then start orchestrating.
- **A prep assistant** (optional, off by default). It rewrites a vague request into a self-contained prompt, read-only, and mails it to the orchestrator (hive.ts:1588).
- **Generated docs.** `PROTOCOL.md` (hive.ts:2955-3100) and `COMMANDS.md` are written into the hive root. PROTOCOL.md defines:
  - the message schema;
  - the "rules of the road" (2989): only `request`, `query` and `propose` expect a reply;
  - the Ask-me rules (3009);
  - the breaker rules (3035);
  - fleet monitoring (3044);
  - spawning workers (3054).
- **How handoff works: files plus a router, with FIPA-style speech acts** (HIVE.md §4, hive.ts:54-81).
  - A message is `{id, conversation, in_reply_to, from, to: id|god|broadcast|human, act, subject, body, hops, requires_reply, needs_human}`.
  - The main process polls every outbox ("cheap and robust vs fs.watch quirks", hive.ts:1831). It delivers each message to the recipient's `inbox/` with an atomic write: temp file, then rename.
  - Bad JSON goes to `.sent/bad-*`, so the router does not spin on it.
  - Only the main process commits to the hive git repo (single committer, with retry and stale-lock recovery).
  - `HOP_CAP = 12` (hive.ts:205) stops ping-pong loops.
  - Mail sent to `human` goes to the orchestrator.
  - Mail to an archived agent is filed, and the sender is told nobody will answer.
- **How agents wake up for mail.** HIVE.md described a `Stop` hook that returns `decision:block` to keep agents draining. **The code dropped that** (hooks.ts:490-500). The reason: it *"bypassed terminal-draft/HITL safety and could spend credits while a user was answering"*. Agents are now woken by a guarded idle nudge typed through the queue. [V]
- **Live roster.** The orchestrator's roster is pushed as `additionalContext` on every `SessionStart` and `UserPromptSubmit` (hooks.ts:536; `rosterContext` at hive.ts:2588). The text starts `[LIVE ROSTER …] … SUPERSEDES any roster earlier`. Each row carries tokens, $, inbox, breaker and ctx%.
- **Standing goals.** A goal is injected as `<goal>…</goal>` once per session and again only when it changes (hooks.ts:552-575).

## 4. Task board, inbox, memory and "Ask me"

- **Task ledger** (`hive/tasks.json`). The model is `HiveTask` (hive.ts:113-150):

  ```
  {id, title, description, assignee, status: todo|doing|blocked|done,
   dependsOn[], priority, createdAt,
   humanQA[{q, a?, askedAt, answeredAt, dismissedAt}], result?, slack?}
  ```

  - The orchestrator writes the file by hand.
  - The UI never overwrites fields it does not know about: `mergeTaskLedger` and `patchTaskInLedger` (`src/shared/taskLedger.ts`).
  - Ticket keys look like `bmt-12` (CHANGELOG Unreleased).
- **Ask me** (`src/renderer/src/components/AskMeTab.tsx:12-28, 98-133`).
  1. The orchestrator sets the card to `blocked` and pushes `{q, askedAt}` onto `humanQA`.
  2. The UI polls `tasks.json` every 5 s and lists open asks, newest first. Each card shows the chain of tasks that depend on it ("why isn't X done").
  3. When the human answers, the UI writes `a` and `answeredAt` into that entry, then sends `{to:'god', act:'inform', subject:'HUMAN ANSWER on task …'}`.
  4. **Dismiss** sets `dismissedAt` and never invents an answer.
  5. Workers do not ask the human directly. They message `god`, and `god` rewrites the ask.
- **Rules for writing an ask** (PROTOCOL.md 3009-3033, godLine):
  - one bold sentence first;
  - at most about 700 characters ("a report, not a question");
  - backticks for paths and commands;
  - one bullet per option;
  - never paste an agent's report as the question;
  - never block your own session waiting for the answer.
- **Inbox.** Per agent: `agents/<id>/inbox/*.json`, `inbox/.done/` and `cursor.json`. Inform-only mail is filed quietly.
- **Memory** (HIVE.md §2.4 and §7).
  - Per agent there is `identity.md` (written by the harness) and `memory.md` (written by the agent).
  - There is a shared `board.md`, and `log.jsonl` is append-only.
  - Optional semantic search uses the MemPalace CLI (`src/main/memory.ts`). Each agent's `memory.md` is mined into its own "wing", and agents run `mempalace search`.
- **"Who did what"** is not a separate store. It comes from three things:
  1. the rule that `assignee` is never cleared (godLine);
  2. a Tasks tab per agent;
  3. `log.jsonl`.

  A memory graph shows agents as nodes and messages as edges (`MEMORY_GRAPH_SPEC.md`).
- **Bounding memory** (`src/main/reflect.ts:1-80`). `memory.md` has three regions:
  - `📌 Durable facts`, which is never condensed;
  - `🗜 Condensed history`;
  - `Recent`, the newest K sections, kept verbatim.

  When the file passes the 128 KB budget, Haiku condenses the oldest Recent sections and "hoists" new durable facts into the pinned region. The process is backup first, then a verification gate, then an atomic swap. The output uses fixed markers (`<<<CONDENSED>>>`, `<<<HOIST>>>`, `<<<END>>>`).

## 5. Circuit breaker and limits

**It does not read the subscription's 5-hour or weekly limits at all.** [V] A grep for `rate_limit` or `usage limit` in `src/` finds nothing relevant.

- **An earlier attempt was removed.** CHANGELOG 0.3.9 (lines 412-417) says a "usage-limit hold" (`rateLimit.ts`, `limitGate.ts`, `useLimitWatch.ts`) was **removed entirely**: *"Agents held behind a limit stayed held — the stated reset never arrived"*. The 0.5.6 "token limits per period (5h/daily/weekly/monthly)" in the README are self-set token budgets in closed code. [D]
- **The breaker itself** (`src/main/breaker.ts`). It is pure policy with no side effects. The beat runs every 30 s (index.ts:5283) and is enforced in `runBreakerBeat` (index.ts:1199-1277). It measures:
  - the same tool called with the same input 8 times in a row. The key is a SHA-256 of `name + JSON(input)`, with strings capped at 4096 characters (lines 228-250);
  - 5 API errors in a row;
  - output velocity above 60k tokens per minute, computed as the difference between cumulative samples;
  - a per-agent cap on **work tokens, which excludes `cacheRead`** (#189: cache reads were 98-99% of the count);
  - a floor-wide $ or token cap that blames only the top spender;
  - "no progress": two beats with output velocity but no recent hive-file change, no new distinct tool, no change in the work directory, and no human prompt.
- **The ladder.**
  - `steer` sends an inbox message (*"STOP repeating, summarize, ask god"*).
  - `constrain` says *"switch to read-only/plan … get god's sign-off"* and shows a desktop toast.
  - `stop` kills the PTY, but only if `hardStop` is on. It is **off by default**, so the breaker caps at constrain.
  - The breaker moves up at most one level per beat and recovers one level per healthy beat.
  - Compaction gets a grace window so a `/compact` burst does not trip it.
  - The orchestrator is never auto-steered or killed.
- **Cost inputs.** Claude Code OTel goes to a local collector; the fallback is reading transcript JSONL (`src/main/usage.ts`, `transcript.ts`). Lifetime $ is folded from an append-only `cost-ledger.jsonl`. The blog postmortem "the-spend-counter-that-went-back-to-zero" explains why.

## 6. Crash restart, floors and isolation

- **Resume.**
  - `session_id` is captured from every hook payload (`recordSession`, hive.ts:1208-1222). It is also captured from the cost sample if hooks did not fire (index.ts:1234).
  - On respawn, `--resume <sid>` is attached **only if the transcript exists**. It is copied into the target cwd's project directory first, because Claude keys sessions by cwd (index.ts:2863-2886).
  - "Restart & Continue" kills and respawns the agent in the same cwd or worktree with `requireResume:true`. It fails loudly rather than silently starting fresh (CommandCenterPanel.tsx:397-510).
  - After sleep, `healthCheckPtys` (index.ts:5310) probes each PID with `kill(pid,0)`. The renderer then auto-respawns dead PTYs with resume (useHive.ts:1169-1249).
  - **There is no auto-restart on an ordinary crash** in the open code. The user clicks the button. [V] Each PTY keeps an 8 KB tail ring so a crash can show what was on screen (pty.ts:37-74).
- **Environment hygiene** (`src/main/ptyEnv.ts`).
  - It strips every inherited `CLAUDE_CODE*` and `CLAUDE_*` variable except `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK` and `CLAUDE_CODE_USE_VERTEX`.
  - The reason given: `CLAUDE_CODE_CHILD_SESSION` from a parent session "silently DISABLES transcript saving", which breaks `--resume`.
  - It also sets `LANG`, because Finder-launched apps have none.
- **Worktrees** (index.ts:2730-2752; git.ts:263-283).
  - This is optional, per agent (`isolate:true`).
  - Command: `git worktree add <harnessHome>/worktrees/<id> -b agent/<id> <currentBranch>`.
  - `node_modules` is symlinked from the base checkout (`worktreeDeps.ts`).
  - Ephemeral workers' worktrees are **kept if they are dirty or ahead of base** (`finalizeWorkerWorktree`, index.ts:528). The orchestrator is told, and a garbage-collection pass reclaims the worktree after merge.
  - **Caveat:** in 0.4.6, normal agents get `worktree remove --force` on teardown (index.ts:487-491), so their uncommitted work can be lost. The README says 0.5.3 fixed this ("crashes keep your work"), but that code is closed.
- **Floors.**
  - In the open code, `openFloor()` (index.ts:2478) opens another `BrowserWindow`. It has its own renderer partition and its own PTY routing, but **the hive stays global** (config.ts:295-303).
  - The rule "one folder opens in only one floor, each with its own board and memory" is from 0.5.3 docs only. [D]

## 7. UI and animation

- **Rendering.**
  - A Pixi.js v8 canvas draws a Tiled map (`office.tmj`) built from LimeZu 16×16 tiles (`TiledMapRenderer.ts`).
  - Characters are `AnimatedSprite`s: 18×32, with down, up and right rows (left is right flipped), and animations `walk`, `type`, `read` and `idle` (`CharacterSprite.ts`).
  - The cast is **drawn procedurally** from recipes: skin, clothes, face, hair, glasses (`portraitArt.ts`).
  - Movement uses A* pathfinding on the tile grid (`pathfinding.ts`).
  - The rest of the UI is React with pixel-styled CSS tokens (`DESIGN.md`).
- **States mapped to behaviour** (OfficeFloor.tsx:1455-1565):

  | State | What the avatar does |
  |---|---|
  | working / thinking | sits at its desk; a thought bubble shows the live action ("using Edit"); the desk monitor lights up (`DeskScreen.ts`) |
  | waiting | sits at its desk, without the focus glow |
  | blocked (needs you) | walks to the door with a pulsing "!" |
  | compacting | a "boxing up" glyph |
  | looping | a spinning warning glyph, set by the breaker |
  | success / idle | wanders around; goes on coffee breaks and errands (at most 4 in the cafeteria) |
  | ghost | 50% opacity |

  - **A cheer plays only after 60 s or more of real work** (`CHEER_MIN_BUSY_MS`, line 83), so a quick inbox reply does not trigger it.
  - **Board changes are acted out** (lines 1330-1370). A new card means a character walks over and pins a sticky note ("pinning a new task 📌"). Doing means the assignee "grabs my task". Done means it is "filed". Blocked means "this one is stuck 😤".
  - **An envelope flies from desk to desk** for each routed message. It is tinted by speech act: request is sky, query lilac, done mint, refuse coral, and anything to the human is coral (`MessageEnvelope.ts:15-26`).
- **Design rules worth copying** (DESIGN.md §1, §3.4, §8.6-8.8):
  - *"Information through motion: an avatar walking IS the status."*
  - There are fixed status color tokens: idle, thinking, working, waiting, blocked, success, ghost, compacting and looping.
  - A walking avatar carries a token for its tool: paper for Read/Edit, `>_` for Bash, a globe for Web, a checklist for TodoWrite.
  - SPEC.md §10 warns: if a walk does not tell you something faster than a label, "we built a toy".
- **Pro UX** (`docs/pro/index.html`), copied as ideas only:
  - a status vocabulary: "Working, Thinking, Needs you, Waiting, Compacting, Looping, Idle";
  - "Send queues until free; Steer lands on next turn";
  - "Pause tools / Stop after this step / 1:1 (orchestrator sends it nothing)";
  - board moves are staged, then one Send hands them all to the orchestrator;
  - a card that asks you something wears a chip;
  - a bell appears only when a question is waiting;
  - a "your draft" badge explains why the queue is held (message-queue.md §5).

## 8. Tech stack and architecture

- **Stack.** Electron 32, electron-vite, React 18 and zustand. Pixi.js 8, xterm 5 with WebGL, and node-pty. better-sqlite3 stores window bounds, history and the cost ledger (`db.ts`). Monaco/CodeMirror power a built-in IDE, and i18next handles languages. It is not Tauri. [V] (`package.json`)
- **Process model.**
  - The main process owns the PTYs, hook socket, router, single-committer git, breaker beat, scheduler, and Slack and webhook servers.
  - The renderer owns the drain queue and the scene.
  - They talk over a typed `window.cth` contextBridge (`src/preload/index.ts`).
  - Docs call these "two planes": terminal and event (`docs/ARCHITECTURE.md`).
- **Persistence.** Everything is plain files under `<harnessHome>/hive/`:
  - `registry.json`, `tasks.json`, `board.md`, `log.jsonl`, `fleet.json`, `cost-ledger.jsonl` and `agents/<id>/…`;
  - plus `roster.json` and the config file.

  The hive is a git repo that only the main process commits to.
- **Scheduling.** Missions can repeat on an interval or on local weekdays and times. A slot missed during sleep fires once on wake (`src/shared/weeklySchedule.ts`; index.ts:5296-5330). Built-in jobs are an hourly orchestrator heartbeat ("standup") and auto-compaction.
- **Telemetry** (`TELEMETRY.md`, `src/main/analytics.ts`).
  - PostHog, anonymous, with `$ip:null` and a hard allowlist of about 12 events (`message_sent` carries only `surface`).
  - Opt-out works three ways: a Settings toggle, `DO_NOT_TRACK`, or a source build, which has no key and sends nothing.

## 9. Clever or surprising things

- **Control through hook return values instead of keystrokes**: deny, `continue:false`, `additionalContext`. These are race-free and never collide with the user typing.
- **A per-session `--settings` file.** It never edits the user's `~/.claude`, and gives each agent its own hooks, statusLine, sandbox and MCP servers (hive.ts:1245-1306).
- **The statusLine shim** is the only clean source of the real context window size (200k vs 1M).
- **The system prompt is kept prompt-cache-stable.** Volatile data goes through hooks and the inbox.
- **"Closing time"** (`src/main/closingTime.ts`). This is a graceful shutdown:
  1. the orchestrator broadcasts it;
  2. each worker commits WIP, updates `memory.md` and replies `CLOSING-TIME-ACK`;
  3. the orchestrator sends `CLOSING-TIME-COMPLETE`;
  4. the app quits.
- **Bundled "temporal" skills** (`resources/skills/today`, `last7Days`, …). Agents run a script for exact date ranges instead of working them out themselves.
- **The 4-part dispatch contract** and the **"Ask is ≤700 chars, bold lead"** rule are cheap prompt wins.
- **Lessons the authors learned the hard way**, recorded in the CHANGELOG:
  - Stop-hook forced continuation was removed.
  - The usage-limit hold was removed.
  - Cache reads were excluded from budgets.
  - Transcripts were being read from the wrong directory for months.
  - A cost counter reset on restart and under-reported by 59%.

**Docs drift [V]:** the blog post "how-the-god-orchestrator-works" and SPEC/HIVE describe a "human-approval queue" and a Stop-hook drain. The code says neither exists.

---

## Top 8 things Nimion HQ should borrow (ranked)

1. **Strip the parent Claude session's environment.**
   - **Value:** high. If the server is started from a Claude Code terminal, inherited `CLAUDECODE` and `CLAUDE_CODE_*` markers can turn off transcript saving and break `--resume`, and it fails silently. Keep the operator's config variables.
   - **Effort:** S.
   - **Read:** `src/main/ptyEnv.ts` (whole file, about 90 lines).
2. **Ask me through the task card.**
   - **Value:** high. It closes the "no human-question flow" gap.
   - **How:** add `blocked` and `humanQA[{q,a,askedAt,answeredAt,dismissedAt}]` to your kanban. The boss (or a worker that ends with a structured question) sets the card to blocked. The UI answer writes `a`, then resumes the boss with `--resume <session_id>` and the Q&A. Copy the ask-formatting rules into `crew.json`.
   - **Effort:** M.
   - **Read:** `src/main/hive.ts:113-150, 3009-3033`; `src/renderer/src/components/AskMeTab.tsx:12-170`; `src/shared/taskLedger.ts`.
3. **A per-run `--settings` JSON with hooks plus the OS sandbox, instead of permission prompts.**
   - **Value:** high. It fixes "a headless run can't answer prompts". Hooks fire in print mode too. [I]
   - **How:** write a per-agent settings file with `sandbox.filesystem.allowWrite` and `permissions.additionalDirectories` for the agent's folder. Add a `PreToolUse` hook that calls your server to deny gated tools or pause. Run with bypass inside the sandbox, or keep `--allowedTools`.
   - **Effort:** S-M.
   - **Read:** `src/main/hive.ts:1230-1310`; `src/main/hooks.ts:424-545`; `src/main/control.ts`; `src/main/config.ts:850-885`.
4. **The circuit-breaker ladder as a pure module.**
   - **Value:** high. Your breaker only watches plan limits; this adds runaway-loop detection.
   - **How:** your `stream-json` output already gives `tool_use` blocks, so feed `name + hash(input)` into `recordToolUse`. Use the identical-call count (8), error storm (5), velocity and no-progress checks, the steer → constrain → stop ladder, and **exclude cacheRead** from budgets. Steering a headless run means kill plus `--resume` with the steer text, or a hook `additionalContext`.
   - Also take the lesson from 0.3.9: any "hold until reset" needs a reset that is sure to release, and a manual release that really drains.
   - **Effort:** S (copy about 400 lines).
   - **Read:** `src/main/breaker.ts`; `src/main/index.ts:1199-1277`; `CHANGELOG.md:412-417`.
5. **A git worktree per concurrent agent, kept if it holds unmerged work.**
   - **Value:** high. It fixes "all agents share one folder".
   - **How:** `git worktree add <home>/worktrees/<id> -b agent/<id> <branch>`, then symlink `node_modules`. On teardown, keep the worktree if it is dirty or ahead of base, and tell the boss. Do **not** copy the force-remove used for normal agents.
   - **Effort:** M.
   - **Read:** `src/main/index.ts:2723-2752, 443-560`; `src/main/git.ts:250-290`; `src/main/worktreeDeps.ts`.
6. **File memory with bounded condensation, plus who-did-what.**
   - **Value:** medium-high.
   - **How:** give each agent a `memory.md`. The role prompt says read it at start and append at end. The assignee is never cleared, and there is an append-only `log.jsonl`. Condense with a pinned / condensed / recent layout, a Haiku pass, and backup → verify → atomic swap.
   - **Effort:** M.
   - **Read:** `src/main/reflect.ts`; `src/main/hive.ts:1593-1606` (protocol lines); `HIVE.md` §3.
7. **Boss prompt and dispatch rules.**
   - **Value:** medium-high, and it is only prompt text.
   - **What to take:**
     - the 4-part task contract (OBJECTIVE / OUTPUT / TOOLS / BOUNDARIES);
     - "reuse an existing nimion before adding one";
     - pass references, not pasted content;
     - a live roster with tokens, ctx% and status injected into every boss turn (you already pass prior step reports, so add the roster line);
     - keep the role system prompt free of changing values so the cache stays warm.
   - **Effort:** S.
   - **Read:** `src/main/hive.ts:1509-1609, 2588-2650`; `src/renderer/src/hooks/useHive.ts:75-82`.
8. **Status vocabulary and choreography for the nimions.**
   - **Value:** medium. It is the "playful but informative" layer.
   - **States to add:** `waiting` (on another nimion), `blocked/needs-you` (only for asks to the human), `compacting` and `looping` (from the breaker), plus `ghost`. Give each a fixed color token.
   - **Cheer only after 60 s or more of real work.** Animate kanban transitions as a nimion carrying a sticky note. Fly a colored envelope between nimions for each handoff. Show a thought bubble with the live tool ("edit App.tsx"). Show a context gauge from `statusLine`.
   - **Effort:** S per item in your CSS/SVG setup.
   - **Read:** `src/renderer/src/scene/office/OfficeFloor.tsx:83-130, 1330-1370, 1455-1565`; `MessageEnvelope.ts:1-40`; `DESIGN.md` §1, §3.4, §8.6-8.8; `docs/pro/index.html`.

Runners-up:
- Weekly local-time schedules with catch-up after sleep (`src/shared/weeklySchedule.ts`).
- The "Closing time" graceful shutdown (`src/main/closingTime.ts`).
- Temporal date skills (`resources/skills/temporal`).
- The `statusLine` context-gauge shim (hive.ts:3111-3150; hooks.ts:401-416).

---

## Couldn't load or didn't read

- **Pro and 0.5.x source.** It is closed. Public tags `v0.5.2`-`v0.5.5` contain the 0.4.6 tree.
- **The removed rate-limit files** (`rateLimit.ts`, `limitGate.ts`, `useLimitWatch.ts`). They are not in the `v0.3.8` tag tree, so I could not study how they read the limits.
- **Blog.** `docs/blog/` has about 280 posts, mostly SEO. I read the FAQ, the Agent SDK post, the god-orchestrator post, recovering-from-failures, and the spend-counter post. I did not read the others.
- **Website.** I did not read the policy pages (terms, privacy, refund, contact) or `wall.html`. I did not watch the videos (`docs/media/*.mp4`). The site has no separate docs, how-it-works or FAQ pages beyond the blog.
- **Agent instruction files.** `.claude/skills/*` and `resources/skills/*/SKILL.md` were read as data only. Their instructions were not followed.
- **Nothing was run or built.**
