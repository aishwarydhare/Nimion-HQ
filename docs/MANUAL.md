# Nimion HQ: the manual

This is the full reference. For the short tour with screenshots, see the [README](../README.md).

A crew of Claude Code agents with a task board. Every run is `claude -p` (headless Claude Code), so it uses
your claude.ai login (Pro / Max / Team / Enterprise seat) and that plan's limits, never an API key.
Each run gets a clean environment: no API keys, and none of the `CLAUDE_*` variables from a parent Claude session.

See [RESEARCH.md](../RESEARCH.md) for what we learned from Paperclip and Munder Difflin, and which of their ideas we took.

## Quick start

You need:
- **Node 18 or later.** Nothing else to install: Nimion HQ uses only Node's built-in modules.
- **Claude Code**, signed in with a Claude plan: Pro, Max, Team or Enterprise. Install it with `npm install -g @anthropic-ai/claude-code`, or see the [setup guide](https://docs.claude.com/en/docs/claude-code/setup).

```bash
claude auth login                 # once: pick your Claude.ai account, not an API key
./setup.sh                        # checks Node, Claude Code and your sign-in, and runs the self-tests
npm start -- ~/code/my-project    # the crew works in this folder (default: ./workspace)
```

Then open http://localhost:4321. The page is the crew's 3D office (see [The world](#the-world)). On the first visit, the **🚀 Setup** screen checks the same things again and lists the MCP servers and connectors your nimions can use. Open it again at any time from the top bar.

**It only runs on your plan.** Before it starts any run, Nimion HQ checks `claude auth status`. If Claude Code isn't signed in, or would use an API key (for example from `apiKeyHelper` or `env` in `~/.claude/settings.json`), no nimion starts and the header shows **⚠️ Setup needed**. Fix it, then press **Check again**. To use Bedrock or Vertex instead, set `HQ_AUTH=any`.

## Tools, MCP servers and connectors

A nimion is your own Claude Code, run as `claude -p` in the crew's folder. So it loads what your Claude Code loads:
- your MCP servers, from `claude mcp add` (user scope) and the project's `.mcp.json`;
- your claude.ai connectors (Settings → Connectors), such as Google Drive, Slack or Notion;
- your plugins, skills, hooks and `CLAUDE.md` files.

Nimion HQ adds one small MCP server of its own, `nimionhq`, for approvals and job history. It never replaces yours.

- **To see what nimions get,** open 🚀 Setup and press **Check my MCP servers and connectors**. It shows each server's name and whether it connected.
- **A server that needs a sign-in** (⚪) must be signed in once in Claude Code: run `claude`, then `/mcp`.
- **A project `.mcp.json` server** must be approved once: run `claude` in that folder and accept it.
- **To let a nimion use a tool without asking you,** add it to the nimion's allowed tools, for example `mcp__github__get_issue`. Otherwise auto mode decides, and anything it can't decide comes to you as an **Allow / Deny** card.

## Your data stays on your machine

The package holds only code and a sample crew. Everything you create stays on your machine and is never in the package:
- `crew.json` (your crew; created from `crew.example.json` on the first run);
- `data.json` (tasks, chats, boss memory and linked folders);
- `attachments/`, `workspace/` and `worktrees/`.

To share Nimion HQ, share the package or run `npm pack`. Never share those files.

## Keep it running (macOS)

`./setup.sh ~/code/my-project --service` installs a LaunchAgent, `~/Library/LaunchAgents/local.nimion-hq.plist`, and opens the page:

- **Starts when you log in, and restarts within about 10 seconds if it stops.** It runs while you are logged in and the Mac is awake. During sleep it pauses, and queued work carries on when the Mac wakes.
- **Logs** go to `~/Library/Logs/nimion-hq.log`.
- **Settings** such as `PORT` or `HQ_MODEL` (see [Configure](#configure)) are saved with the service when they are set as you run the command, for example `HQ_MODEL=sonnet ./setup.sh ~/code/my-project --service`.
- **To change the project folder,** run the same command with the new folder.
- **To turn it off,** use System Settings → General → Login Items, or the commands below.

```bash
launchctl print gui/$(id -u)/local.nimion-hq | grep -E '^\s*(state|pid) '   # is it running?
launchctl kickstart -k gui/$(id -u)/local.nimion-hq                        # restart after changing code or crew.json
launchctl bootout gui/$(id -u)/local.nimion-hq                             # stop it until the next login
```

**Run it by hand.** Stop the service first, or the two copies fight over port 4321.

**Uninstall.** Run `bootout`, then delete the plist.

On Linux or Windows, run `npm start -- <project-folder>` in a terminal, or with your own service manager.

## Use

- **Give it to Tork (the boss).** Tork plans without changing files. It writes each step as a contract: objective, output, tools, boundaries.
  - By default the steps run one after another. Tork can also mark steps to run at the same time on different nimions, with `"after": []` or a list of earlier steps to wait for. It does this only when the steps won't edit the same files, because the whole plan shares one folder.
  - Each step sees the reports from the steps that finished before it.
  - When every step has finished, Tork is woken with the reports. It checks them, then hands out more work or writes the final report. This happens at most 3 rounds.
  - The **final report** always has the outcome, what each nimion did with its key results quoted, every file the crew made (full paths, so they become links), and what is still open. If you stopped a step, Tork reports instead of handing that work out again.
  - If Tork's plan has no task list, it is asked once more.
- **Give it to one nimion.** It goes straight to that nimion. Different nimions can work at the same time. One nimion does one task at a time.
- **Auto mode.** Nimions run in Claude Code's auto mode. Before each tool call that is not on the nimion's `allow` list, a safety check decides:
  - It lets routine work through, such as reading, searching, running tests and editing in the workspace.
  - It blocks risky actions, such as deleting things outside the project, deploying to production or sending data out. The nimion is told why, and tries a safer way or explains in its reply.
  - It judges connector actions too, so a write that clearly matches your request (for example, posting the Slack message you asked for) can run without asking.
- **Needs you.** A nimion raises its hand when it needs you. The tab title shows how many things are waiting.
  - **Tool approvals.** When Claude Code still wants a person to decide, the call waits for your **Allow** or **Deny**. If nobody answers in 30 minutes, the call is denied.
  - **Questions.** A nimion that needs a decision ends its reply with `QUESTION:`, a short question and 2 to 4 suggested answers, its pick first. Click a suggestion on the card to answer in one click. To write your own answer, click the card or the nimion: its chat opens with the question pinned above the reply box. The same session then carries on.
- **Click a nimion or a card** to watch that task's log.
  - **Reply** continues the same Claude session, so the nimion keeps its memory. You can reply while it works: the reply waits and is sent when the current run ends. To send it at once, press **Stop**.
  - **Stop** stops the run. A run that makes the same tool call 8 times in a row is stopped for you.
- **Switch jobs.** The chat window has a list of every job that nimion was given, current and cleared, newest first. For the boss these are your goals. Pick one to read it or reply to it. Clicking a nimion opens its open question first, then what it is working on, then its latest job.
- **Clear** takes finished jobs off the board but keeps them, so they stay in the job list and in history. A reply brings a job back to the board.
- **Boss memory (🧠).** Tell Tork lasting guidance in any job, for example "from now on, keep reports under one page". Tork saves it as short bullets and follows it on every later job, and puts the parts that matter into its task contracts.
  - Before saving, Tork compares the new guidance with every saved line. If it clashes with a line and you didn't say it replaces it, Tork asks which should hold before saving anything. It also asks when it isn't sure what you mean.
  - The memory is pinned on the **guidance board** by the boss's desk, one note per line. When the boss saves guidance from a chat, you see a note fly to the board. Click the board to edit a note, add one or take one down, or undo the last change. It holds up to 8,000 characters.
  - When there is nothing for the crew to do (a question, a report, guidance to save), Tork just answers.
- **History.** Every nimion can search past jobs and read one in full with two read-only tools, `history_search` and `history_get`, which never ask you. Ask Tork things like "what did we decide about the login page?" and it looks them up instead of keeping them in memory.
- **Files in replies.** A file path in any reply (`/full/path/report.html`, `notes/plan.md`, a `file://` link) becomes a link when the file exists inside the crew folder or the data folder; relative names are looked up in that job's folder and its steps' worktrees.
  - **Click** to preview it here: markdown is rendered, HTML pages, PDFs and images show in a frame (HTML runs sandboxed, cut off from this app), and text files show as text. A folder opens in Finder.
  - **Hover** for **VS Code**, **Browser** and **Finder**. Opening uses `open` with the path as an argument, never a shell, and only for files inside those two folders.
- **🗄️ Deliverables** (the filing cabinet in the room, **O**, or the palette) lists every file the crew made, one row per file: written or edited by a nimion (seen in its Write and Edit calls), or named in a reply such as the boss's final report. Each row shows the job (and the boss job it came from), the nimion, when, and the type, with search and filters by nimion, job and type. Click a name to preview it, hover for VS Code, Browser and Finder, with the same folder guard as file links. Only paths are kept on the job, never copies, so a file that was moved or deleted shows as **no longer there**.
- **Usage.** Every run's result is recorded on its job: tokens in and out (cache included), time and turns, plus the notional API price when the CLI reports one. It's a subscription, so tokens and time come first and any dollar figure is marked notional; jobs from before this was added say "usage not recorded".
  - Each chat shows its job's usage under the title; a boss job shows the whole thread, steps included, and the boss's own share.
  - Mission board groups show their tokens; the NR office shows each nimion's today, 7 days and all time.
  - Click the **5-hour** meter for **who used this window**: each nimion's tokens, time and share since the window began.
- **📜 Live log** (the top bar, or the log screen on the wall) streams every nimion's activity in one place as it happens: your messages, replies, tool calls, approvals and errors. Click a line to open its task. The same lines go to `~/Library/Logs/nimion-hq.log`.

## The world

The page is a 3D office built with three.js (0.170.0, MIT, saved in `vendor/three/`, so it works offline). It fills the window and *is* the app: every feature opens as a popup from something in the room.

**What's in the room** (hover anything to see its name; click to open it):

| Object | Opens |
| --- | --- |
| 📨 Red **NEW JOB** box by the boss's desk | the new-job form (also **＋ New job** in the top bar) |
| 📋 **Mission board**, the big wall screen | the full board, grouped by the job you gave the boss: each group shows the job, when, its state and progress ("2 of 3 steps done"), with its steps under it in plan order. Jobs given straight to a nimion share **Direct jobs**, and scheduled runs share **⏰ Scheduled**. Groups that need you come first, then working, queued and finished; finished groups start folded (▶ opens one, and the title opens the boss chat). The wall shows the same groups, one row each: open ones and those finished today |
| 📌 **Guidance board**, the cork board by the boss | the boss memory, one note per line |
| 🚪 **NR door** (Nimion Resources) | the NR office: your crew's profiles, stats and skills |
| ✋ **Needs you** sign | tool approvals and questions waiting for you. It glows and counts |
| 📚 **Bookshelf** | linked context |
| 🗄️ **Filing cabinet** under the bookshelf | the deliverables shelf. Its plate counts the files |
| 📜 **Live log** screen | the live log |
| 🕹️ **Arcade** cabinets | ten small games |
| 🕰️ **Wall clock** by the boss | nothing: it shows your local time, with a seconds hand. The top bar shows the time too |
| 🖥️ A **desk** or a nimion | that nimion's chat, with its job list |

**The top bar** shows your plan usage, a ✋ count of things waiting for you, **＋ New job**, **📜 Live log**, **☰ Room**, **🌙 dark mode**, **⛶ full screen** and **🚀 Setup**. On a narrow window the buttons show icons only. **☰ Room** lists every object and every nimion: it is the keyboard and screen-reader way to everything.

**Moving around:**
- **Drag** to look around. The view is limited, so you never end up behind a wall.
- **Scroll** or pinch to zoom.
- **Double-click** or **⟲ Fit** shows the whole room again. It also eases back on its own after 20 seconds.
- Opening something flies the camera to it, beside the popup. Closing flies back.
- **Esc** closes the topmost thing: the menu, the chat, a popup, the live log, then full screen.

**Keyboard shortcuts** (press **?** to see them). They are single keys, so they rest while you type in a box, while a dialog is open, and while the arcade is open, where the games use the keys.

| Key | Does |
| --- | --- |
| N | New job |
| B | The boss chat (its latest job) |
| [ and ] | Previous / next nimion's chat |
| Q | Questions and approvals waiting for you |
| J, G, M, A | Mission board, guidance board, NR office, arcade |
| L | Live log |
| F | Full screen. The icon shows which way it goes |
| D | Dark or light mode |
| O, S | Deliverables, schedules |
| ⌘ K | **Command palette** (Ctrl + K on Windows): type to jump to any nimion, job (current or past, searched as you type), popup, schedule, arcade game or action (new job, dark mode, full screen, time of day). Arrow keys, Enter, Esc |
| ⌘ Enter | Send the job or reply (Ctrl + Enter on Windows) |

**Day and night.** The office follows your local clock: the windows show the sun crossing the sky by day (warm at sunrise and sunset) and the moon and stars by night, the light changes colour, and the lamps come on at dusk. To fix it, pick **Time of day: always day** or **always night** in the command palette (⌘ K); **follow the clock** goes back. The choice is saved in this browser.

**Dark mode** follows your system until you pick one with 🌙 or **D**; the pick is saved in this browser. Popups, chat and boards go dark. In the room, dark mode only darkens the walls and floor and dims the light a little; the time of day still comes from the clock (or your choice above), so dark mode at noon is a dark room with daylight in the windows.
- **Links:** `#job/12` opens job 12's chat, and `#nr`, `#board`, `#guidance`, `#arcade`, `#context`, `#needs` or `#compose` open those popups. Use them in bookmarks.
- Rendering pauses while the window is hidden.

**What the nimions do:**
- **Idle:** they wander, chat, get a banana, juggle, or play at the arcade. Two idle nimions also play together: catch, a kick-about with the corner ball, tag, or a board game at the round table. Work always comes first: a nimion given a job stops playing at once, and so does its partner.
- **Working:** they sit at their desk and type. The monitor shows the job's title, and a paper pile at the front of the desk grows with each queued job (with a count) and shrinks as the work gets done.
- **Needs you:** they stand by the desk, wave, hop, and show an orange "!". The monitor says so too.
- **Waiting:** they tap a foot. **Paused** by the usage breaker: they sleep.
- **Finished:** they jump with their arms up in a burst of confetti, then carry the paper to the boss. A failure gets a facepalm and a red paper.
- **Hand-offs:** when a step passes from the boss to a nimion, the boss walks the papers over (envelopes fly if the boss is busy). When one nimion's step finishes and the next nimion's step waited for it, the first nimion walks the papers to the next desk. No walk keeps a nimion from work for more than a few seconds.
- **Your games:** when you win an arcade game (a new best, or a 2-player win), idle nimions cheer; when you lose, they groan and shrug.
- **New hires** walk in through the NR door.

**The arcade.** Ten original games. Play while the crew works, and idle nimions gather round the cabinets to cheer. The best five scores per game are kept. Two players share one keyboard: P1 uses **W A S D + Space**, P2 the **arrow keys + Enter**. Speed is the same at any refresh rate.

| Game | Players | What it is |
| --- | --- | --- |
| Fruit catch | 1, co-op | catch fruit and bananas, dodge the rotten ones |
| Crate stack | 1 | drop sliding crates into a tower |
| Face match | 1, 2 (turns) | find the pairs of nimion faces |
| Paper plop | 1, 2 (turns) | throw a paper ball into a moving bin, with wind |
| Banana bumpers | 1, 2 (turns) | a pinball table with flippers, bumpers and banana targets |
| Goggle-bot raid | 1, co-op | a fixed shooter against marching goggle-bots |
| Banana bricks | 1, co-op | a brick breaker with wide-paddle and multi-ball power-ups |
| Banana volley | 1 vs CPU, 2 | paddle tennis, first to 7 |
| Banana dash | 1, co-op, 2 | a top-down road race: dodge traffic, grab fuel |
| Hill hurlers | 2, 1 vs CPU | an artillery duel on hills, with wind and craters |

**Needs WebGL 2.** The office is the app, so there is no 2D version. If the browser has no WebGL 2 (or it fails to start), the page says so, with what to change and a **Retry** button; the server and your jobs are not affected. `/lab3d-demo.html` plays through every state without real tasks.

## Your crew: the NR office

Click the **NR door** (or **☰ Room → NR office**). Each nimion has a profile card: its portrait, title, model, skills, how many tool rules it has, and its stats from every job kept: jobs done and failed, average time, current load, and the tokens and time it used today, in 7 days and in all. From here you can **hire**, **edit** and **retire** nimions. The boss can't be retired.

When you hire or edit a nimion, you set:
- **Name.** This can't change later, because tasks use it.
- **Title**, and the **role** that becomes its standing instructions.
- **Model.** Leave it blank to use your default.
- **Looks:** a style, eyes, a prop and a colour, with a live preview.
  - **Style:** **Sprout** (a leaf sprout and a scarf), **Bobble** (a bobble on a stalk, a gumdrop body and an HQ badge on a lanyard) or **Tuft** (a tuft of hair and a striped jumper). What a nimion wears is in its own colour, the one that marks its desk and its chat. A nimion with no style set is a Sprout.
  - **Props:** there are 20: hats (hard hat, cap, beanie, top hat, crown), glasses and sunglasses, headphones or a headset, a bow tie, and things to hold (wrench, hammer, pencil, paintbrush, magnifier, flask, mug, book, clipboard, laptop). A hat hides what is on the head. An unknown prop draws nothing, so older crews stay valid.
  - **Colour:** one of 12 swatches tested to read well on the nimions in light and dark. A colour saved before the swatches still works and shows as **custom**. A nimion with no colour set is Mango.
- **Skills:** Claude Code skills it should use.
- **Tools it may use without asking**, one per line. For example `WebSearch`, `Bash(npm test*)` or an MCP tool such as `mcp__github__get_issue`.

Changes are saved to `crew.json` right away, and the next run uses them.

### Skills

A nimion can have one or many **Claude Code skills**: your own (`~/.claude/skills`), your plugins' (named `plugin:skill`, such as `engineering:code-review`), and the project's (`.claude/skills`).
- **What you can pick.** The list is what a run can really load, taken from Claude Code's start-up (init) event. Nimion HQ saves it from every run. If it has none yet, opening the editor starts one tiny run that stops as soon as Claude Code lists its skills. **Check again** does the same after you install a skill. Descriptions come from each skill's `SKILL.md`.
- **What the nimion is told.** Its instructions list its skills with their one-line descriptions, and tell it to load the right one with the Skill tool when a job fits. Each skill is pre-approved with a `Skill(<name>)` rule.
- **How the boss uses them.** The boss's roster shows every nimion's skills next to its title and role. The boss is told to weigh skills as well as persona when it picks who does a step, and to name the skill to use in the step's TOOLS line.
- **Project skills and worktrees.** In a git repo, each job runs in its own worktree, so a project skill must be committed to be there.

**How Tork adapts.** Each time Tork plans, it gets the live roster: every nimion's title, the first sentence of its role, its skills, and how much work it already has. So a new nimion gets work as soon as its title, role or skills say what it's good at, with no code change. Tork gives each step to the best fit, can give several steps to one nimion, leaves out nimions it doesn't need, and runs independent steps on different nimions at the same time.

## Linked context

Click the **bookshelf** (or **☰ Room → Linked context**) to link folders that every nimion may explore on every task, such as a docs repo, other services or notes. Add a short note on what each one is.

- Nimions are told about these folders in their instructions. They can read them with `Read`, `ls`, `grep` and `find` without asking, through a `Read(//folder/**)` rule.
- Any change inside a linked folder needs your approval. Your crew's own workspace stays writable, even if it sits inside a linked folder.
- Unlink a folder with its ×. Your home folder and `/` are refused as too broad.

## Attachments

You can attach things to a new task, or to a reply in the task drawer:

- **Files and images.** Use **📎 Files**, drag them onto the form, or paste them (screenshots work). Nimions read images and PDFs directly, and Word, Excel and PowerPoint files through your skills.
- **Folders, or any local file.** Paste its path into the box and press Enter. In Finder, ⌥⌘C copies a path. A browser can't send a whole folder, so folders go by path.

How they are handled:

- **Files are copied** into `attachments/` (50 MB each, at most 20 per message), so a nimion only ever changes the copies.
- **Folders stay where they are and are read-only.** They work like linked context, but for this task only: `Read`, `ls`, `grep` and `find` work without asking, and any change needs your approval. A nimion that is allowed to run shell commands (for example `python3`) could still write there, so keep `allow` lists short. Your home folder and `/` are refused as too broad.
- **Tork's steps get the same attachments as the goal.** A reply tells the nimion only about the new attachments, because the session already knows the earlier ones.
- `attachments/` is never cleaned up for you. Delete it when you no longer need old tasks.

## Git worktrees

If the project folder is a git repo, each top-level task gets its own worktree and branch, `nimion/<id>-<slug>`.
The worktree goes under `./worktrees/<id>`, and Tork's steps share their goal's worktree. So nimions working at the
same time never edit the same files, and your own checkout is never touched.

Nimions do not commit. To keep a task's work, commit it in that worktree, then merge the branch.
Worktrees are never deleted for you. Clean them up when you are done:

```bash
git worktree remove worktrees/<id> && git branch -D nimion/<id>-<slug>
```

If the folder is not a git repo, all nimions share it.

## Limits and the breaker

The 5-hour and weekly bars come from the rate-limit events that the CLI reports during each run.
Before a window reaches `HQ_MAX_UTIL` (default `0.9`), new runs stop starting. They start again by themselves after the window resets.
If the plan starts to use paid extra usage (overage), every run stops.
Scheduled runs stop starting earlier, at `HQ_SCHED_UTIL` (default 0.15 below `HQ_MAX_UTIL`, so `0.75`). This keeps the rest of each window for your own jobs.

## Schedules

Jobs can run later, or on a repeat. Click the **wall clock**, press **S**, or use **☰ Room → Schedules**.

- **Ask the boss in chat**, for example "every weekday at 9, have Pip summarise yesterday's open PRs". The boss saves the schedule with a ```` ```schedule ```` block at the end of its reply, and the schedule is active at once. The chat shows the change with **Pause** and **Undo** buttons. The boss sees every schedule, so it edits a duplicate instead of adding one, and it asks you when a time or a clash is not clear. A scheduled run cannot make more schedules.
- **Or use the popup.** **＋ New schedule**: pick who does it, then **Repeat** (a cron rule: minute hour day month weekday, with presets), **Once, at a time** or **Once, after a while** (such as `2h`). The popup previews the next runs. Each row shows the next run with a countdown, its last run and its run history, with **Run now**, **Pause**, **Edit** and **Delete**.
- **How a run works.** When a schedule is due, it becomes a normal job (its title starts with ⏰) for that nimion or the boss. The prompt says which run it is, and what the last run reported. In a git folder, every run of a schedule uses the same worktree, `worktrees/s<id>`.
- **The rules.**
  - Times are in the Mac's time zone. A time that the clock skips at a DST change runs just after the jump. A time in an hour that repeats runs once.
  - The server checks every 15 seconds.
  - If the Mac slept, or Nimion HQ was off, the latest missed run starts once if it is less than 6 hours late. Otherwise it is skipped, and you see a note.
  - If the last run has not finished (or is waiting on you), the next run is skipped.
  - Runs must be at least 15 minutes apart. At most 12 scheduled runs start in an hour.
  - After 3 failed runs in a row, the schedule pauses itself.
  - A nimion that has schedules can't be retired.
- **In the room.** The plate under the wall clock shows the next run and counts down. It shows 🔔 when a run starts, and it turns grey while scheduled runs wait for the usage window. A nimion with a schedule has a small alarm clock on its desk, and its idle monitor shows a run due in the next hour. The mission board (the wall screen and the popup) shows **⏰ Next up**.
- **Notifications.** A toast when a scheduled run starts, finishes, fails or needs you. Press **🔔 Notify me** in Schedules to also get a system notification while the page is in the background. A click opens the job.
- **The boss's tools.** The boss reads schedules with `schedule_list` and checks a rule with `schedule_preview`. Both are read-only, so they never ask you.
- **Where they run.** Schedules belong to the Nimion HQ server that holds them, so they run while that server runs (the background service: whenever you are logged in). A second copy with its own `HQ_HOME` has its own schedules.

## Configure

- `crew.json` sets each nimion's `name`, `title`, `role` (its system prompt), `look` (`style`: `sprout`, `bobble` or `tuft`; `eyes`: 1 or 2; `prop`: one of the props above, or none; `tone`: a `#rrggbb` colour), `allow` (tools it may use without asking you), `skills` (Claude Code skill names), `model` (optional) and `boss`.
- `PORT` (default `4321`).
- `HQ_HOME` (default: the Nimion HQ folder): where `crew.json`, `data.json`, `attachments/` and `worktrees/` live. Useful for tests, or to run a second copy with its own crew and jobs.
- `HQ_MAX_UTIL` (default `0.9`): the share of a limit window at which new runs stop starting.
- `HQ_SCHED_UTIL` (default `HQ_MAX_UTIL - 0.15`): the share of a limit window at which scheduled runs stop starting.
- `HQ_AUTH=any` lets runs start without a Claude plan sign-in, for Bedrock or Vertex.
- `HQ_MODEL` sets one model for the whole crew. For example, `sonnet` or `haiku` makes your limits last longer.
- `HQ_PERMS` (default `auto`). `acceptEdits` approves only file edits and asks you about everything else. Use `bypassPermissions` only in a throwaway folder: it skips every check.

## Know before you use it

- **Allowed commands run any code.** If you allow `python3` or `node`, the nimion can run any code without asking. Keep the `allow` lists short.
- **The server trusts local programs.** It accepts requests from this machine only, and it refuses other websites. But a nimion that is allowed to run `curl` could approve its own requests.
- **Startup cost.** Each run loads your normal Claude Code setup (plugins, hooks, MCP servers). This uses about 25k cached tokens before the nimion starts its work.
- The characters are original art. They are not film assets.
