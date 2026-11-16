# Scheduling in Nimion HQ: the plan

> **Update (2026-11-15):** the Electron desktop app was removed; Nimion HQ is shared only as the git repo. The notes below about the app (its own data folder and schedules, `summary().app`, §5.6) are history: the server is the only owner.

Status: phase 1 is built (the timer, the API, the boss block, the popup, the tests). The popup is `data-panel="schedules"` (`#schedules`), and the wall clock already opens it. Phase 2 is built too: the boss's `schedule_list` and `schedule_preview` tools, rules in words, the editor's presets and attachments, and Edit on the chat line. Phase 3 is built: the clock's "next run" plate (with the ring and the held state), the desk hints and alarm clocks, "Next up" on the wall board and the board popup, toasts and web notifications, `N` inside Schedules. Phase 4 is not started. Phase 3 left out a bell glyph (the plate shows 🔔 instead) and a `lab3d-demo.html` scheduled state (the demo page has no states to add one to). The 5 open questions are decided (see §7). Written 2026-11-15 against `main` at `1b01fe1`, plus the uncommitted
`FINAL_REPORT` change in `server.mjs` that another session is making now.

## In five lines

1. A **schedule** is a saved job (nimion or boss, prompt, attachments) with a rule: once at a time, in N minutes or hours, or a repeating 5-field cron rule in the Mac's time zone. Schedules are kept in `data.json` as a new `schedules` key, so older builds keep working.
2. **The server owns the timer.** It checks every 15 seconds. When a schedule is due, it adds a normal queued task, so the usage breaker, one run per nimion, worktrees and the boss's delegate and review loop all work with no change.
3. **Safe defaults.** At most one open run per schedule. After sleep or a restart, the latest missed run starts once, but only if it is less than 6 hours late. Scheduled runs do not start above 75% of the 5-hour window, which keeps headroom for you. Runs are at least 15 minutes apart and limited per hour. A schedule pauses itself after 3 failures in a row.
4. **The boss** makes and changes schedules with a ```` ```schedule ```` block, like the ```` ```memory ```` block. It reads them with the read-only MCP tools `schedule_list` and `schedule_preview`. Its prompt shows the current schedules, so it can find duplicates and ask when it is not sure. A scheduled boss run ends with the existing `FINAL_REPORT`, which links to the job and its files.
5. **In the world**, the wall clock becomes the ⏰ **Schedules** object, with a "next run" plate under it. Its popup creates, edits, pauses, deletes and previews schedules, and shows each schedule's runs. Desks, the mission board, toasts and macOS notifications show upcoming and finished runs. Delivery is in 4 phases, and phase 1 (the engine, the boss block and a basic popup) is about 1 to 2 days of work.

---

## 0. What exists today, and what this plan reuses

| Piece | Where | Why it matters here |
| --- | --- | --- |
| `addTask(prompt, nimion, extra)` | `server.mjs` | A due schedule calls this. A scheduled run is a normal task with `extra.schedule = <id>`. |
| `tick()` and `setInterval(tick, 60_000)` | `server.mjs` | Already starts queued tasks when the breaker clears. Deferral at the plan limit costs no new code. |
| `pickRunnable` | `server.mjs` | One run per nimion at a time. This is the concurrency limit that schedules inherit. |
| `breakerTripped(limits, now, max)` | `server.mjs` | Takes `max` as an argument already, so a lower limit for scheduled runs is a one-line call. |
| `load()` | `server.mjs` | Resumes `working` tasks after a restart. The catch-up for schedules goes next to it. |
| `delegate` / `wakeBoss` / `FINAL_REPORT` | `server.mjs` | A scheduled boss run plans, hands out work, reviews, and ends with a report that lists files. Nothing new is needed. |
| `parseMemory` / `bossRules` | `server.mjs` | The pattern for the new `parseSchedule` block and the "## Schedules" section of the boss's rules. |
| `history_search` / `history_get` | `approve-mcp.mjs` + `/api/history` | The pattern for the new read-only `schedule_list` / `schedule_preview` tools, which are pre-approved in `HISTORY_TOOLS`. |
| `checkAttach` | `server.mjs` | Checks a schedule's attachments when the schedule is saved and again each time it fires. |
| `PANELS`, `openPanel`, `parseHash`, `objGroup`, `OBJ` | `index.html`, `world.js`, `lab3d.js` | A new `schedule` panel and room object, with the `#schedules` link. |
| The wall clock | `lab3d.js` (`clock`, `clockHands`, about x -3.8, y 2.5 on the back wall) | It becomes the clickable Schedules object. **Another session is changing it now. Agree on this first.** |
| `HQ_HOME` | server + `electron/main.cjs` | The LaunchAgent and the desktop app use **different data folders**. Each one has its own schedules. See §5.6. |

Today there is no global cap on runs, only one run per nimion. `data.json` is written with a plain `writeFileSync`, so a crash during the write can leave half a file. Phase 1 changes this to the tmp-and-rename write that `saveCrew` uses already (§2.4).

---

## 1. Scheduling model

### 1.1 Kinds of schedule

| Kind | How you say it | Stored as | Phase |
| --- | --- | --- | --- |
| **Once** | "at 5pm", "tomorrow 09:30", "on 1 Dec at 10:00" | `once: <epoch ms>` | 1 |
| **Relative** | "in 2 hours", "in 20 minutes" | Changed to `once` when it is saved. It is not stored as relative, so a restart does not move it. | 1 |
| **Repeating** | "every weekday at 9am", "every Monday 08:00", "every 4 hours", "on the 1st of each month" | `cron: "0 9 * * 1-5"` (5 fields: minute, hour, day of month, month, day of week) | 1 |
| **Event** | "after the nightly build schedule finishes", "when a file appears in ~/inbox" | `on: { after: <scheduleId> }` or `on: { watch: <folder> }` | 4, maybe |

**Plain language goes into cron outside the server.** In chat, the boss (an LLM) changes "every weekday 9am" into `0 9 * * 1-5`, and checks it with `schedule_preview` (§3.3). In the popup, presets (every day, weekdays, weekly on chosen days, every N hours) build the cron, and **Advanced** lets you type one. The server parses only cron and timestamps. That parser is about 40 lines, with no dependency, and it supports `*`, lists, ranges and `/` steps. The popup shows every rule in words ("Weekdays at 09:00") through a small pure helper, `HQW.describeCron`.

### 1.2 What a schedule holds

```jsonc
{
  "id": 3,
  "name": "Morning PR digest",            // shown everywhere; 1–60 chars
  "nimion": "Tork",                       // a crew name; the boss is allowed (then the run plans and delegates)
  "prompt": "Summarise yesterday's open PRs in …",
  "attach": [{ "path": "/…/attachments/ab12/spec.pdf", "kind": "file", "name": "spec.pdf", "size": 81234 }],
  "cron": "0 9 * * 1-5",                  // or "once": 1794730800000
  "tz": "Europe/London",                  // the Mac's zone when the schedule was saved; shown, see §2.3
  "paused": false, "pausedWhy": null,     // "3 failures in a row", "nimion Pip was retired", …
  "overlap": "skip",                      // skip | queue   (see below)
  "catchUp": "latest",                    // latest | none
  "atLimit": "wait",                      // wait | skip
  "maxRuns": null, "until": null,         // optional stop after N runs / after a date
  "carry": true,                          // tell the run what the last run reported (≤1,500 chars)
  "nextAt": 1794733200000,                // the next slot, kept in sync on every change and every fire
  "runs": 12, "fails": 0,                 // fired so far; failures in a row
  "history": [{ "slot": 1794646800000, "task": 141, "at": 1794646803000, "status": "done", "ms": 184000 }], // last 20
  "by": "Tork (task #120)",               // or "you"
  "created": 1794560000000, "updated": 1794560000000
}
```

- **Skills** come from the target nimion, as they do for every task. A schedule does not have its own skill list. To ask for a skill, the prompt says so, in the same way as the boss's TOOLS line. This keeps the NR office as the one place that sets skills.
- **Context.** Linked context applies to scheduled runs as it does to every run. Each scheduled run's prompt starts with a short header: *"Scheduled run 13 of 'Morning PR digest' (weekdays at 09:00), due 09:00, started 09:00. The last run (#141, Fri 14 Nov) reported: …"*. Set `carry: false` to leave out the last report.
- **Overlap.** `skip` is the default. If this schedule's last run is still queued, working or waiting on you, the new slot is skipped and logged as such. With `queue`, one more run may wait. Never more than one, so runs do not pile up.
- **The workspace.** Every top-level task gets a new git worktree today, and worktrees are never deleted. A daily schedule would make 365 worktrees in a year. So **each schedule has one worktree, `worktrees/s<id>`, on the branch `nimion/schedule-<id>-<slug>`, and every run of it reuses that worktree**. `workspaceFor` gets a 3-line branch for `t.schedule`. Nothing is ever deleted.
- **Sessions.** Each run starts a fresh Claude session and does not resume the last one. This keeps context and cost flat. The `carry` header passes on what matters. You can still reply to any run's chat, as with every job.

### 1.3 Where it is stored

- `data.json` gets two new keys: `schedules: []` and `nextScheduleId: 1`. Scheduled tasks get two new fields: `schedule: <id>` and `slot: <epoch ms>`.
- **This is compatible in both directions.** `load()` reads the whole file into `state`, and `changed()` writes `state` back as it is. So an older build keeps keys it does not know, and a newer build adds `state.schedules ||= []` next to the existing `state.context ||= []`. Tasks with extra fields already work (for example `round`, `fixTried` and `queuedReply`).
- Not in `crew.json`: schedules are runtime state, not crew setup, and `crew.json` belongs to you.
- Not in a separate file. One file means one atomic write, so a task and the schedule's `nextAt` always change together (§2.4).
- Limits: at most 50 schedules, a prompt of up to 20,000 characters, and the same attachment rules as tasks.

---

## 2. The timer engine (inside `server.mjs`)

### 2.1 The tick loop

- A new `setInterval(scheduleTick, 15_000)`, next to the existing 60-second `tick`. `scheduleTick` compares `now` with every `nextAt`. With 50 schedules or fewer, this is a few microseconds.
- **Precision:** a run starts within 15 seconds of its time. Agent runs take minutes, so this is enough. A `setTimeout` to the exact time would be more complex, and it would still need the interval to detect sleep.
- **Sleep detection:** if the time since the last `scheduleTick` is more than 45 seconds, the Mac slept or the process was stopped. That tick goes through the catch-up path (§2.2). It also calls `tick()` at once, so work that is queued starts without a wait of up to 60 seconds.
- `nextAt` is computed only when a schedule is saved, fires, is resumed or catches up, and never on every tick. `nextAfter(cron, fromMs)` walks forward one minute at a time with the local `Date` getters, skipping whole hours and days that cannot match, and gives up after 366 days. This is fast enough for 50 schedules.

### 2.2 Missed runs (Mac asleep, LaunchAgent down, app closed)

The catch-up runs in two places: in `load()` after a restart, and in `scheduleTick` after sleep is detected. For each schedule that is not paused and has `nextAt < now`:

| `catchUp` | Behaviour |
| --- | --- |
| `latest` (default) | Fire **once**, for the latest missed slot, if that slot is **less than 6 hours late**. Log it, for example: *"Missed 3 runs while the Mac was asleep. Ran the 09:00 run at 09:47."* A slot that is more than 6 hours late is skipped, and the card says *"missed (Mac asleep), next Tue 09:00"*. |
| `none` | Skip every missed slot and move on to the next future slot. |

- A **once** schedule that is more than 6 hours late is not fired. It is marked `missed`, and you are told (in a toast and on the card) with a **Run now** button.
- This works like launchd's `StartCalendarInterval`, which also runs a missed job once after wake. So the behaviour is the one a Mac user knows.
- It never makes up for every missed slot. A Mac that is asleep over a weekend does not start 3 days of hourly runs on Monday.

### 2.3 Time zones and DST

- **Rules are in the Mac's local time zone**, which is what "9am" means to you. Phase 1 uses Node's local `Date`, so if the Mac moves to another zone, the schedules follow it (§5.7 has a caveat that is not verified). `tz` is saved and shown, so a change of zone is visible ("Saved in Europe/London, the Mac is now in Asia/Tokyo"). A fixed zone per schedule (with `Intl`) is phase 4, only if someone asks for it.
- **Spring forward** (01:00 to 02:00 does not happen): a slot inside the gap, such as 01:30, runs at the first minute after the jump (02:00). It is never skipped, the same as cronie. To do this, `nextAfter` walks real (UTC) minutes. When the local offset changes between two minutes, it also checks the wall times that were jumped over, and a match there fires at the first minute after the jump.
- **Fall back** (01:00 to 02:00 happens twice): a slot inside the repeat runs **once**, the first time. Walking real minutes would reach local 01:30 twice, so `nextAfter` skips a candidate whose local wall-clock minute (Y-M-D H:M) is the same as the last fired slot's.
- "Every 4 hours" (`0 */4 * * *`) is in wall time, so it can be 3 or 5 hours apart on a DST day. The preview shows this.
- Tests run with `process.env.TZ = 'Europe/London'` (Node reads TZ again when it is changed) on the 2026-03-29 and 2026-10-25 changes.

### 2.4 Never more than one run for the same slot

1. **One owner.** Only the server process fires schedules. The browser and Electron never do (§5.6).
2. **One synchronous step.** In one JS turn, the server: finds that a schedule is due, sets `nextAt` to the next slot, appends to `history`, calls `addTask(..., { schedule, slot })`, and calls `changed()`. Node runs one thing at a time, so no other tick can come in between.
3. **One atomic file.** The task and the new `nextAt` are in the same `data.json`. Phase 1 changes the flush in `changed()` to write `data.json.tmp`, then `renameSync`, like `saveCrew`. So a crash saves both changes or neither. This also protects all your existing data.
4. **A restart check.** In `load()`, before a catch-up fires a slot, it checks whether a task with the same `schedule` and `slot` exists already. If one does, the slot was fired before the crash, and only `nextAt` is fixed.
5. **Two servers, one data folder.** This cannot happen on the default setup. The LaunchAgent and the app use different `HQ_HOME` folders, and a second `npm start` on the same port fails to bind. A lock file is not needed. If it becomes possible later (for example, if the app attaches to the service, §7 Q4), then add a `HOME/.lock` with the PID.

### 2.5 The usage breaker and the 5-hour window

Scheduled runs use the same subscription windows as your own work, so they get **lower priority**:

| Situation | What happens | Code |
| --- | --- | --- |
| Breaker tripped (a window is at `HQ_MAX_UTIL`, 90%, or overage started) | The task is added and **waits** in the queue, as all work does today. It starts when the window resets. | none (existing `tick`) |
| Above **75%** of a window (`HQ_SCHED_UTIL`, default `HQ_MAX_UTIL - 0.15`) | Scheduled tasks wait, and your own tasks still start. You keep the last 15% for yourself. | in `tick`: `pickRunnable(...).filter(t => !t.schedule \|\| !breakerTripped(state.limits, now, SCHED_UTIL))` |
| Still waiting when the next slot comes | That slot is skipped, because the last run has not finished (`overlap: skip`). Runs never pile up. | overlap check |
| `atLimit: skip` | The slot is not added at all if the breaker is tripped when it is due. Use it for "only useful at 9am" jobs. | in `fire()` |
| Overage starts during a run | The existing code stops every run, and scheduled runs are stopped too. A stopped run counts as a failure for the auto-pause (§5.1). | none |

`state.limits` comes from the last run's `rate_limit_event`, so it can be hours old. `breakerTripped` already ignores a window whose `resetsAt` is in the past, so an old number does not block a run after a reset. When the popup shows "waiting for the 5-hour window", it uses the `resetsAt` it already has ("resets 14:00").

### 2.6 Concurrency

- **Per nimion:** one run at a time (existing `pickRunnable`). A schedule for a busy nimion waits behind its work, in the same queue.
- **Per schedule:** one open run (overlap `skip`), or two with `queue`.
- **Fire rate:** each schedule fires at most once every 15 minutes, and all schedules together fire at most **12 times per hour** (§5.1).
- **No new global cap on parallel runs in phase 1.** The crew has 6 nimions, so 6 parallel runs at most, and the breaker covers the cost. If many schedules start together at 09:00, the per-nimion queue spreads them out.

### 2.7 In-process timer compared with launchd and macOS calendar options

| Option | How it works | For | Against |
| --- | --- | --- | --- |
| **In-process timer** (recommended) | `setInterval` in `server.mjs` | One owner, and all data in `data.json`. Missed-run, DST, breaker and overlap rules in one place, testable in `test.mjs`. Works in the LaunchAgent, in `npm start` and in the app with no difference. No new files outside `HOME`. | Runs only while the server runs. The LaunchAgent covers this, because it is always on while you are logged in. |
| launchd `StartCalendarInterval`, one plist per schedule | Each schedule writes `~/Library/LaunchAgents/local.nimion-hq.s<id>.plist`, and that job `curl`s the server | macOS runs missed jobs after wake and handles DST | It still needs the server to be up, so nothing is gained. It writes and bootstraps plists from a web request. It cannot express `*/4`, ranges or `until` without lists of dicts. Plists are left behind when the data is deleted. The app's data folder would need its own plists. It is hard to test. |
| `cron` / `at` | crontab lines | Simple | Deprecated on macOS. Does not run missed jobs after sleep. Needs Full Disk Access on recent macOS. |
| macOS Calendar or Reminders (EventKit through AppleScript or Shortcuts) | Events in a "Nimion HQ" calendar, polled | You see the schedule in Calendar.app | Permission prompts, slow AppleScript, fragile parsing of free text, and a second source of truth. |
| `pmset schedule wake` | Wakes the Mac for a slot | Runs on time even when asleep | Needs `sudo`. It is a system setting, so it is out of scope. |
| Claude Code cloud routines (`/schedule`) | Runs in the cloud | Runs when the Mac is off | Does not use the local crew, worktrees or `data.json`. Different product. |

**Recommendation: the in-process timer.** launchd adds no value while the server runs, and it adds plists, cleanup and permission problems. If "run while the Mac sleeps" becomes a need, it is a separate decision about the Mac, not about this timer.

---

## 3. The boss

### 3.1 Asking in chat

You say *"Every weekday at 9, have Pip summarise yesterday's open PRs and send me the list"* in the boss's chat. The boss replies in words ("I'll schedule that: weekdays at 09:00, first run Mon 17 Nov") and ends with two blocks:

````
```schedule
[{ "op": "add", "name": "Morning PR digest", "nimion": "Pip",
   "prompt": "OBJECTIVE: … OUTPUT: … TOOLS: … BOUNDARIES: …",
   "cron": "0 9 * * 1-5" }]
```
```json
[]
```
````

- **The ops:** `add` (fields as in §1.2; `in: "2h"` or `at: "2026-11-15T17:00"` are allowed and become `once`), `edit` (`id` and the fields to change), `pause`, `resume`, `delete`, `run` (run now).
- **Parsing:** a new pure `parseSchedule(text)` takes the last ```` ```schedule ```` block, like `parseMemory`. It is applied in the `close` handler only when `m.boss` is true and the status is `done` or `needs-you`, next to the memory save. Each op goes through the same `checkSchedule` validation as the REST API. The result is logged in the chat as a system line (*"⏰ Scheduled #3 Morning PR digest: weekdays at 09:00, next Mon 17 Nov 09:00"*) or as an error (*"⏰ Not scheduled: 'Gru' is not in the crew"*). Errors are also sent back to the boss as one requeue, in the same way that `delegate` nudges once when a plan has no `json`.
- **No work now:** `delegate()` treats a reply with a ```` ```schedule ```` block like one with a memory block, so it is not nudged for a missing plan. `parsePlan`'s regex skips ```` ```schedule ```` blocks already, because the word `schedule` makes `JSON.parse` fail. A test checks this.
- **Who may write:** only the boss's blocks are read. **A block from a scheduled run (`t.schedule` is set) is ignored and logged**, so a schedule can never create more schedules (§5.1).
- **Why a block and not a write tool:** every change shows in the chat you are reading, it is applied only when the run ends without error, and it uses the same path as `json` and `memory`. A write tool on the shared MCP bridge would let any nimion change schedules in the middle of a run, unless we added a check of who is calling.

### 3.2 Listing, changing, pausing and deleting

- **What the boss sees:** `bossRules` gets a "## Schedules" section with the rules for the block, and a compact list of the current schedules, rebuilt on every run like the crew roster (`#3 Morning PR digest · Pip · weekdays 09:00 · next Mon 09:00 · active`). For most questions ("what's scheduled?", "pause the digest"), the boss needs no tool call.
- **MCP tools** in `approve-mcp.mjs`, next to `history_*`. They are read-only and added to `HISTORY_TOOLS`, so they never ask:
  - `schedule_list({ query? })`: every schedule with its rule in words, the next 3 times, its status and its last 5 runs (job id and status).
  - `schedule_preview({ cron? | at? | in? , n? })`: the next N times, or the parse error. The boss calls it before it writes an `add` or `edit`.
  - The server has the matching `GET /api/schedules` and `POST /api/schedules/preview` routes (preview has no side effects).
- Run history stays in `history_search` / `history_get`. Scheduled jobs are normal jobs, and their titles start with the schedule's name.

### 3.3 No conflicts or duplicates, and asking when unsure

Rules for the boss's prompt, in the style of the memory rules:
- **Before you add a schedule, compare it with every schedule in the list.** If one has the same nimion and almost the same prompt, or the same name, **edit it** and do not add a new one. If the new schedule clashes with an existing one (same nimion and time, or the opposite instruction), do not write a block. Ask with `QUESTION:` which should hold, and quote both.
- **Ask first** if the time is not clear ("in the morning", "regularly", "soon"), if the time zone is not clear, if the target is not clear, or if the rule would fire more often than every hour. Give 2 to 4 options with concrete times, the recommendation first. The one-click answers on the existing question card do the rest.
- Check every new rule with `schedule_preview`, and say the first run time in words in the reply.
- Keep schedule details out of ```` ```memory ````. Memory holds guidance, and schedules hold jobs.
- The server enforces the hard limits (§5.1) whatever the boss writes, and the error goes back to the boss.

### 3.4 Reporting after a scheduled run

- **Boss target:** the run is a normal boss job. It plans, delegates, is woken with the reports, and ends with `FINAL_REPORT`: Outcome, Who did what, Files (absolute paths) and Open. The other session's file links make those paths clickable.
- **Nimion target:** the nimion's reply is the report. For scheduled runs, the run header adds: *"End with a short report: the outcome in one or two sentences, then every file you made or changed with its full path."*
- **Where you see it:**
  1. The job's chat (`#job/<id>`), and the schedule's run history in the popup.
  2. A toast and a macOS notification: *"⏰ Morning PR digest finished (Pip, 3 min): <the first line of the outcome>"*, with a click that opens the job. A failure says "failed", and a question says "needs you".
  3. The **"Done today"** column of the mission board, with a ⏰ badge.
- **A digest (phase 3, optional):** a schedule with `report: "boss"` sends a nimion's result to a short boss job that compares it with the last run ("3 new PRs since yesterday"). Leave it out until someone asks for it.

---

## 4. The interface in the 3D world

### 4.1 The in-world object: the wall clock becomes "⏰ Schedules"

- **The clock already on the back wall** (about x -3.8, y 2.5, by the shelves and the "needs you" sign) becomes a clickable object: `objGroup('schedule')` wraps it, and `OBJ.schedule = ['⏰', 'Schedules']`. There is no new wall clutter, and it is where people look for time.
- **A "next run" plate** under the clock (a small canvas texture, like the bookshelf's count plate): *"⏰ 09:00 Morning PR digest · in 2h 14m"*, or *"⏰ nothing scheduled"*. It is drawn again once a minute, and each second in the last minute.
- **When a run fires,** the clock rings: a short shake and a bell glyph, about 1 second. Then the target nimion walks to its desk as it does today.
- **The clock is paused** (a grey plate, *"⏸ paused: 5-hour window at 78%"*) while scheduled runs are held by the 75% headroom rule.
- **Agree with the other session first.** It is adding a wall clock now. Phase 3 builds on whatever clock lands. The only need is a group that `objGroup` can register, and a spot for the plate. Check the placement with a screenshot.

### 4.2 The popup (`data-panel="schedule"`, `#schedules`)

- A `PANELS.schedule = ['⏰', 'Schedules']` entry, so it is also in **☰ Room**.
- **The list,** soonest first. Each row has: a nimion tint dot, the name, the rule in words, a **live countdown** to `nextAt` (updated each second on the client, from the SSE `nextAt`), a status chip (`active` / `paused (why)` / `waiting: 5-hour window` / `running #141` / `missed`), and the last run as a link with its status icon. Row buttons: **Run now**, **Pause / Resume**, **Edit**, **Delete** (with a confirm that says the past jobs stay in history).
- **The editor** (also opened by **＋ New schedule**):
  - The nimion (a select, with the boss first), the name, and the prompt (Cmd+Enter saves, as in compose). Attachments use the compose form's 📎 widget.
  - **When:** tabs **Once** (`datetime-local`), **In** (N minutes or hours), **Repeat** (presets: every day at, weekdays at, weekly on [M T W T F S S] at, every N hours, monthly on day N; and **Advanced: cron**).
  - **Preview:** *"Next 5: Mon 17 Nov 09:00, Tue 18 Nov 09:00, …"* from `/api/schedules/preview`, updated as you type. Errors and the 15-minute minimum show inline.
  - **Options** (collapsed, with defaults shown): if the last run is still going, skip or queue one; missed runs, run the latest once or skip; at the plan limit, wait or skip; stop after N runs; end date; pass the last report on.
- **Run history per schedule:** expand a row to see the last 20 runs (slot, start, duration, status, and a link to `#job/<id>`), and skipped or missed slots with the reason ("skipped: last run still working", "missed: Mac asleep").
- **Runtime note** in the popup footer: *"Schedules run while this Nimion HQ runs: the background service (always on while you are logged in)"*, or, in the app (`summary().app`): *"…only while the Nimion HQ app is open. Quit it and nothing runs."*

### 4.3 Desks and the mission board

- **Desk monitor:** if the nimion's next scheduled run is in the next hour, the idle monitor shows *"⏰ 09:00 Morning PR digest"*. A nimion with any active schedule has a small alarm clock on its desk. It is a tiny static mesh, so it costs little.
- **Mission board, the wall screen:** a thin **"Next up"** strip under the columns with the next 3 runs in the next 24 hours.
- **Mission board, the popup:** a scheduled job's card gets a ⏰ badge and the schedule's name. The "to do" column shows a waiting scheduled run as *"⏰ waiting: 5-hour window resets 14:00"*.
- **The ✋ Needs you sign** works as today. A scheduled run that asks a question is the same as any other question.

### 4.4 Notifications

- **In the app or the page:** toasts with the existing `toast()` when a scheduled run starts (a short one), finishes, fails, needs you, is skipped because of the limit, or is missed. Only finishes, failures and questions stay on screen until you close them.
- **macOS, while a window is open:** the page's own `Notification` API (the Electron app is gone, so this is the only kind). The browser asks for permission once, from a button in the popup ("🔔 Notify me"), never on page load. A click focuses the window and opens `#job/<id>`. Only when the page is hidden (`document.hidden`), so you do not get both a toast and a banner.
- **macOS, with no window open (phase 4, opt-in):** the server runs `osascript -e 'display notification …'` when no SSE client is connected (`clients.size === 0`). This works from the LaunchAgent with no app. The text is the schedule name and the status only, with no prompt text.

### 4.5 Keyboard shortcuts

- **`S`** opens or closes Schedules when you are not typing, with the same guard as `F` (no modifier keys, not in an input, no open dialog). **Use the shortcut map that the other session is adding**, and do not add a second `keydown` listener. If `S` is taken, use `T` (timetable).
- In the popup: **N** for a new schedule, **Cmd+Enter** to save, **Esc** to close (as today), and **↑ / ↓** to move between rows, with **Space** to pause or resume the selected row.
- Every control is a real `<button>` with a label, so screen readers work. The countdown has `aria-live="off"`, because a live region that changes every second is noise.

### 4.6 Dark mode

- The popup uses only the CSS custom properties that already switch under `prefers-color-scheme: dark` (`index.html` line 16), and whatever theme toggle the other session adds. It has no hard-coded colours.
- Canvas textures (the plate, the "Next up" strip, the desk monitor line) read the same tokens through `getComputedStyle` when they are drawn, and are drawn again on the theme-change event that the dark-mode work fires. Check both themes with a screenshot in phase 3.

---

## 5. Edge cases and safety

### 5.1 Runaway recurring jobs

| Guard | Default | Enforced in |
| --- | --- | --- |
| The shortest time between two slots of one schedule | 15 minutes (`checkSchedule` rejects a cron if two of its next 50 slots are closer) | save |
| Fires across all schedules | 12 per hour. Above that, slots are skipped and logged, and one toast shows | `fire()` |
| The number of schedules | 50 | save |
| Failures in a row | 3, then **auto-pause** with `pausedWhy` and a notification | run `close` handler |
| A schedule that makes schedules | Never: blocks from runs with `t.schedule` are ignored | block parse |
| Open runs per schedule | 1 (`skip`) or 2 (`queue`) | `fire()` |
| The cost of a boss run | Already limited by `BOSS_ROUNDS = 3`, the loop detector and the breaker | existing |

### 5.2 A max-runs cap

`maxRuns` and `until` are optional on every schedule. When either is reached, the schedule pauses itself with *"Finished: ran 10 of 10 times"*. It is not deleted, so its history stays. A **once** schedule is `maxRuns: 1` in effect, and it shows as "done" after its run.

### 5.3 A dry run: a preview of the next N times

- `POST /api/schedules/preview { cron | at | in, n ≤ 20 }` gives `{ times: [...], words: "Weekdays at 09:00", warnings: ["DST: 29 Mar 01:30 runs at 02:00"] }` or `{ error }`. It is pure, with no side effects. The popup and `schedule_preview` both use it.
- **Run now** is the "try it" button: it fires one run at once. That run counts as a run, but it does not move `nextAt`.

### 5.4 A schedule whose nimion was retired

- `/api/crew/remove` already refuses while the nimion has open work. It also refuses while **active schedules** point at it: *"Pip has 2 schedules (Morning PR digest, …). Move them to another nimion or delete them first."* The popup's Edit can change the nimion.
- If `crew.json` is edited by hand and the nimion is gone, `fire()` does not add a task. It pauses the schedule with *"Pip is not in the crew"* and notifies you. (Today `run()` would fail the task, which counts as a failure, and pausing is clearer.)
- An attachment that is gone when the schedule fires: the run goes ahead without it, the run header says which file is missing, and the card shows ⚠️. A run that is missing input is better than a silent skip.

### 5.5 The app quits while the LaunchAgent keeps running

- **They are two separate Nimion HQs** with two data folders: the LaunchAgent uses this repo's folder, and the app uses `~/Library/Application Support/Nimion HQ/`. Each has its own crew, jobs and schedules. Quitting the app stops the app's server, so **the app's schedules stop**. The LaunchAgent's schedules go on.
- When the app opens again, its server runs the catch-up (§2.2): the latest missed slot runs once if it is less than 6 hours late.
- The popup footer says which runtime you are looking at (§4.2), so a schedule made in the app is never thought to run all the time.

### 5.6 Electron or the server: which one owns the timer

*History: the Electron app was removed, so this is settled: the server owns the timer.* **The server owns it in every case.** Electron only started a server (`electron/main.cjs`) and shows a window. If the timer were in Electron, it would not run under the LaunchAgent or `npm start`, and closing the window would stop it. The browser never fires anything: it only shows `nextAt` and counts down. Later options for the app (phase 4, see Q4): keep running in the menu bar when the window closes, or attach to the LaunchAgent's server when one is running, so there is only one set of schedules.

### 5.7 Other cases

- **The clock jumps** (a manual time change or an NTP correction): the same as sleep. Catch up the latest slot, and never fire a slot twice (`slot` check).
- **The Mac's time zone changes:** `nextAt` must be computed again for every schedule. Not verified: whether a running Node process sees a change of the system zone, or keeps the zone it started with until a restart. Phase 1 must test this. If Node does not see the change, the 15-second tick compares the zone (read with a short `execFile('date', ['+%Z'])` once a minute) and computes again. If that does not work either, the popup asks you to restart the service.
- **Sign-in problem (`setup.problem`):** due tasks are added and wait, as all work waits today. The card says *"waiting: Claude sign-in"*.
- **You edit a schedule while its run is going:** the run goes on with the old prompt. The change applies to the next slot.
- **You delete a schedule while its run is going:** the run finishes. Its job stays in history, and the job keeps `schedule: <id>` with the name saved on the job.

---

## 6. Phased delivery

Sizes are rough and include tests. **S** is up to half a day, **M** is about a day, and **L** is 2 days or more.

### Phase 1: the engine, the boss block and a basic popup (the smallest useful slice). Size M to L, about 350 lines.

- **Server:**
  - `state.schedules`, plus the tmp-and-rename write for `data.json`.
  - The pure functions `parseCron`, `nextAfter`, `dueSlot` (with catch-up), `checkSchedule`, `parseSchedule` and `scheduleNote`.
  - `scheduleTick` (15 seconds, with sleep detection), the catch-up in `load()`, and `fire()` with overlap, `atLimit`, the hourly cap and the missing-nimion pause.
  - The 75% headroom filter in `tick`.
  - The `t.schedule` worktree reuse in `workspaceFor`.
  - Auto-pause after 3 failures, and the `/api/crew/remove` guard.
- **API:** `GET /api/schedules`, `POST /api/schedules` (create or edit), `POST /api/schedules/:id/(pause|resume|run|delete)`, `POST /api/schedules/preview`, and `schedules` in `summary()`.
- **Boss:** the "## Schedules" rules and the list in `bossRules`, the ```` ```schedule ```` block applied on `close`, the `delegate` no-work case, and the run header with `carry`.
- **UI:** the ⏰ Schedules popup, reached from **☰ Room** and `#schedules`: a list with countdown, status, Run now, Pause, Resume and Delete. Creating schedules is done in chat with the boss, and a raw form (nimion, prompt, cron or datetime) is the fallback. No 3D object yet.
- **Tests:**
  - Unit tests in `test.mjs` for cron parsing (fields, steps, ranges, bad input), `nextAfter` for weekdays 9am, month ends and Feb 29, and DST spring and fall in `TZ=Europe/London`.
  - Catch-up: 3 missed slots run once, a slot 7 hours late is skipped, and a once schedule that is late is marked missed.
  - Overlap `skip` and `queue`, the hourly cap, and the 15-minute minimum.
  - `parseSchedule`: the last block wins, bad JSON, an unknown nimion, and blocks from scheduled runs ignored. `parsePlan` ignores ```` ```schedule ````. The headroom filter with `breakerTripped`.
  - **One integration test:** start `server.mjs` on a **temporary `HQ_HOME` and port 4399** with a fake `claude` on `PATH` (a 10-line script that prints `stream-json` init and result lines). Create a schedule for 1 minute ahead with a fake clock (an `HQ_NOW_OFFSET` test hook, or a `scheduleTick(now)` parameter). Check that one task appears, that restarting the server does not fire it again, and that `data.json` keeps unknown keys. **Never against port 4321.**

### Phase 2: the full editor and the boss tools. Size M, about 250 lines.

- The popup editor with presets, the live preview, options and attachments. Run history per schedule, with skipped and missed slots.
- `schedule_list` and `schedule_preview` in `approve-mcp.mjs`, added to `HISTORY_TOOLS`.
- A chat card after a boss block: *"⏰ Scheduled … · Pause · Edit · Undo"* (undo deletes it, or puts the old version back after an edit).
- `HQW.describeCron` and `HQW.countdown` in `world.js`.
- **Tests:** `describeCron` cases (`0 9 * * 1-5` gives "Weekdays at 09:00", `*/30 * * * *` is rejected as too frequent), an MCP `tools/list` and `tools/call` round trip against the temporary server, and the popup driven in the browser pane on the temporary server (create, preview, pause, delete) with screenshots.

### Phase 3: the world, notifications, shortcuts and dark mode. Size M, about 200 lines.

- The clock as the ⏰ object, the "next run" plate, the ring animation and the paused state (after the other session's clock lands).
- The desk monitor line and alarm clock, the mission board "Next up" strip, and the ⏰ badges.
- Toasts, and the web `Notification` with click-to-open.
- The `S` shortcut in the shared shortcut map, and the popup keys.
- Dark mode tokens for the popup and the canvas textures.
- **Tests:** screenshots in light and dark mode and at narrow width. The plate text at 5 seconds, 59 seconds and 2 hours. `lab3d-demo.html` gets a "scheduled" state, so it can be checked without real runs. (The packaged-app notification test is dropped: the Electron app was removed.)

### Phase 4: later, only if needed. Size L in total, each item S to M.

- Event triggers: `on.after` (chain after another schedule's run) and then `on.watch` (a folder, with `fs.watch` and a debounce).
- `osascript` notifications when no window is open.
- A fixed time zone per schedule.
- The boss digest of a nimion's scheduled result.
- **Tests:** for each feature, the same temporary-server pattern.

---

## 7. Decisions (the user approved every recommended answer on 2026-11-15)

1. **A schedule the boss makes in chat is active at once.** The chat shows **Undo** and **Pause** for it.
2. **Scheduled runs stop starting at 75% of a usage window** (`HQ_SCHED_UTIL`, default `HQ_MAX_UTIL - 0.15`). Your own jobs go on to the 90% breaker.
3. **After sleep or downtime, the latest missed slot runs once, if it is less than 6 hours late.** Otherwise it is skipped, and you are told.
4. **The service and the app each keep their own schedules.** The popup says which one you are in.
5. **No event triggers for now.**

The questions as they were asked, for the record:

1. **Should a schedule the boss makes in chat be active at once, or wait for your click?**
   *Recommended:* active at once. A card with **Undo** and **Pause** shows in the chat. The boss already asks when the request is not clear, and the server limits (15 minutes, 12 per hour, 3 failures) cap the damage.
2. **How much of the 5-hour window should scheduled runs leave for you?**
   *Recommended:* scheduled runs stop starting at 75% (`HQ_SCHED_UTIL`). Your own jobs keep going up to the existing 90% breaker.
3. **What happens to runs that were missed while the Mac slept or Nimion HQ was off?**
   *Recommended:* run the latest missed slot once, if it is less than 6 hours late. Otherwise skip it and tell you. Each schedule can be set to "skip missed runs".
4. **Which Nimion HQ should own your schedules: the always-on LaunchAgent, or the desktop app?**
   *Recommended:* both keep their own (they have separate data today), and the popup says which one you are in. Make schedules in the LaunchAgent's world (`http://localhost:4321`) for anything that must run when the app is closed. Decide later (phase 4) whether the app should attach to the running service.
5. **Are event triggers ("after X finishes", "when a file appears") needed now?**
   *Recommended:* no. Time-based schedules first. Add "after another schedule" in phase 4 if you ask for it.
