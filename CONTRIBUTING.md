# Contributing to Nimion HQ

Bug reports, ideas and pull requests are welcome.

## Before you send code

- **Open an issue first** for anything bigger than a small fix, so we can agree on the shape before you spend time on it.
- **Run the tests:** `npm test` (the same as `node test.mjs`). They use a fake `claude`, a temporary folder and their own port, so they never touch your crew, your jobs or your plan.
- **No new dependencies.** Nimion HQ uses only Node's built-in modules, plus the bundled copy of three.js.
- **Keep your own data out.** `crew.json`, `data.json`, `attachments/`, `workspace/` and `worktrees/` are yours and are ignored by git. Never commit them.
- **No headers in source files.** Copyright and licence information lives in [REUSE.toml](REUSE.toml).

## Who owns what

Nimion HQ is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). Aishwary Dhare ("the maintainer") is its copyright owner and its only licensor. That is what lets one person license the whole project, including for commercial use.

To keep it that way, every contribution is accepted under the grant below.

### Contributor licence grant

By submitting a contribution to this repository (a pull request, a patch, an attachment to an issue, or any other material), you agree to all of this:

1. **It is yours to give.** You wrote the contribution yourself, or you have the right to submit it. It includes no one else's code, text or art, unless you say so clearly in the pull request and name its source and its licence. If your employer has rights in what you write, you have their permission.
2. **You keep your copyright.** You are not assigning it to anyone.
3. **You give the maintainer a broad licence.** You grant Aishwary Dhare, and anyone who later takes over ownership of the project, a perpetual, worldwide, non-exclusive, royalty-free, irrevocable licence to use, copy, modify, publish, distribute, sublicense and relicense your contribution, as part of Nimion HQ or otherwise, under any terms. That includes commercial and proprietary terms. It also includes a licence to any patent claims you can license that your contribution infringes, alone or combined with Nimion HQ.
4. **Everyone else gets it under the project's licence.** Your contribution is offered to others under the PolyForm Noncommercial License 1.0.0, like the rest of the project.
5. **No warranty.** You provide the contribution as it is, and you do not have to support it.

Each pull request must include this line, which the pull request template adds for you:

> I have read CONTRIBUTING.md and I agree to the contributor licence grant.

If you cannot agree to this, please open an issue that describes the change instead of sending code.
