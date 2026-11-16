# What we learned from Paperclip and Munder Difflin

Studied on 5 Nov 2026. We read both docs sites and both repos in full; nothing from them was run.
The full reports, with file and line references, are in [research/paperclip.md](research/paperclip.md) and
[research/munder-difflin.md](research/munder-difflin.md). We checked the claims we act on against the source code.

## How each one runs Claude on a subscription

| | Paperclip (Paperclip `4ea53f9`) | Munder Difflin (open code is v0.4.6; Pro is closed) | Nimion HQ |
|---|---|---|---|
| How Claude Code runs | `claude --print --output-format stream-json`, or ACP through `acpx` (the default) | an interactive terminal (`node-pty` and xterm.js) | `claude -p --output-format stream-json` |
| Subscription | uses it when no API key is set; does **not** strip `ANTHROPIC_API_KEY` | uses it | uses it, and strips API keys and parent-session variables |
| Permissions | `--dangerously-skip-permissions` by default; no approval for Claude's own tools | `bypassPermissions` plus Claude Code's OS sandbox | **you approve each prompt in the UI** (`--permission-prompt-tool`), plus a per-nimion allowlist |
| Who drives the work | the server wakes an agent; the agent pulls its tasks over REST with a run token | the orchestrator writes JSON mail files; a router delivers them | the server pushes tasks; the boss returns a JSON plan |
| Results flow up | parent woken when all children finish | inbox messages to the orchestrator | the boss is woken with the reports (at most 3 rounds) |
| Asking the human | question cards on the issue, then the agent is woken with the answer | "Ask me" list on the task card | a `QUESTION:` line puts the card in "Needs you"; your answer resumes the session |
| Isolation | git worktree per task (optional), never deletes dirty ones | git worktree per agent (optional) | git worktree per top-level task, never deleted |
| Limits | reads the 5-hour and weekly windows from `api/oauth/usage` (display only); budgets see subscription runs as $0 | no plan-limit reading; it removed a "hold until reset" feature because agents never got released | `rate_limit_event` from each run, with a breaker that releases on reset |
| Runaway runs | throttles repeated wakes that make no progress | loop breaker: same call 8 times, error storms, token spikes | stops a run after the same call 8 times |

## What we took

1. **Clean child environment** (Munder Difflin `src/main/ptyEnv.ts`). A parent Claude session's `CLAUDE_CODE_CHILD_SESSION` turns off transcript saving and breaks `--resume`. This session had about 30 such variables, and all of them reached the nimions.
2. **Approve tool calls from the UI.** Neither tool has this. Paperclip's report suggested the flag, and we tested the contract on CLI 2.1.308: the tool gets `{tool_name, input, tool_use_id}` and answers `{behavior: "allow", updatedInput}` or `{behavior: "deny", message}`.
3. **Questions for the human** (Munder Difflin's "Ask me" rules: one bold sentence, options as bullets, under 700 characters).
4. **4-part task contract** for the boss: objective, output, tools, boundaries (Munder Difflin's orchestrator prompt).
5. **One nudge when a plan has no task list** (Paperclip's rule that every run must end in a usable state).
6. **Wake the boss with the reports** when a round finishes (Paperclip's `issue_children_completed` wake).
7. **A git worktree per task**, never deleted (both tools).
8. **Loop stop**: the same tool call 8 times in a row (Munder Difflin `src/main/breaker.ts`).
9. **Cheer only after 60 s of work** (Munder Difflin `OfficeFloor.tsx`).

## What we skipped, and why

- **ACP engine.** `--permission-prompt-tool` gives the same approval hook with no new package.
- **Agents that pull work over a REST API with run tokens.** This is a lot of machinery for one person on one machine.
- **Budgets in dollars.** On a subscription, Paperclip records $0 per run, so its budgets never trigger. The plan-limit breaker is the budget that matters.
- **Reading `api/oauth/usage`.** It needs the OAuth token from your keychain, and `rate_limit_event` already gives utilisation and reset times.
- **Org chart, goals tree, routines, per-agent memory files, pixel-art office.** These are worth a look later if you want them.

## Sources, licences and how we used them

Checked on 16 Nov 2026, before this repository was published.

| Source | Licence | What we used |
|---|---|---|
| [Paperclip](https://github.com/paperclipai/paperclip), repo and [docs](https://docs.paperclip.ing) | MIT, © 2025 Paperclip AI | ideas only |
| [Munder Difflin](https://github.com/HarnessMD/munder-difflin), repo and [site](https://munderdiffl.in) | MIT for the source code, © 2026 Chaitanya Giri. Its pixel art is licensed separately | ideas only, and none of the art |
| [three.js](https://github.com/mrdoob/three.js) 0.170.0 | MIT, © 2010-2024 three.js authors | bundled unmodified in `vendor/three/`, with its licence |

- **Reading them was allowed.** Both repositories are public and MIT-licensed. Both sites' `robots.txt` allow every crawler and name AI readers as welcome. Neither site's terms of use restricts reading, quoting or studying the open-source code.
- **We took ideas, not files.** No source file, art or other asset from Paperclip or Munder Difflin is in this repository. Everything under "What we took" was written again from scratch. Two small details match their source: the four `CLAUDE_*` variables that `cleanEnv` keeps, and the loop limit of 8. The code comments say where each came from.
- **The notes quote short excerpts** of their code and documentation, with file and line, for commentary. Those excerpts stay under the MIT License.
- **Credit** is in the [README](README.md#credits) and in [NOTICE](NOTICE), with both projects' copyright lines.
- We only describe Munder Difflin's closed Pro version from its public pages. We did not see its code.

## Things to know

- **Billing.** Munder Difflin's report quotes Anthropic's help page as still saying `claude -p` draws from your subscription limits, after a planned June 2026 change was paused. That is the path Nimion HQ uses, so watch for future policy changes. We did not re-check this page ourselves.
- **Docs and code disagree in places.** Munder Difflin's blog describes a human-approval queue and a Stop-hook drain that are not in the code. Paperclip's spec describes CEO strategy approval, which the server does not enforce.
- **Paperclip's agent skill files tell agents to act without asking**, for example "Submit proactively without permission". We read them as data and did not copy them.
