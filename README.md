<p align="center"><a href="https://donatetokens.org"><img src="https://raw.githubusercontent.com/Gillinghammer/toa/main/docs/hero.jpg" alt="A solarpunk city at sunrise under the words: Your unused AI tokens, for the common good." width="100%"></a></p>

# Tokens of Appreciation

**Your unused AI tokens, for the common good.**

Before your weekly reset, your own agent spends what's left fixing open source that does good, and opens the pull request from your GitHub account.

```sh
npx toa-skill
```

No npm? `curl -fsSL https://donatetokens.org/install.sh | sh`. Just the skill, without the scheduler: `npx skills add Gillinghammer/toa`.

Needs Node 18+ and a logged-in [`gh`](https://cli.github.com). No account, no tracking.

---

Every week, the AI you paid for and didn't use expires. TOA spends it on open source that clinics, libraries and classrooms depend on.

## How a donation works

1. **Install once.** `npx toa-skill` adds the TOA skill to Claude Code, Codex, Cursor and your other agent tools, then asks which causes you care about and when to start: 24, 8, 4 or 1 hour before your weekly reset.
2. **Your agent gives what's left.** Shortly before your weekly reset, your agent takes a help-wanted or bug issue in a curated project and works until your leftover usage is spent.
3. **A pull request, from you.** Once a separate review passes, it opens the PR from your GitHub account, or a draft for you to approve if you prefer. Unfinished work picks up next week.

## Where your tokens go

A curated list of open source projects in health, education, climate, accessibility, open knowledge and financial inclusion, such as Open Library, OpenEMR, Kiwix, axe-core and the Wikimedia Commons app. Each was picked for real-world impact, active maintainers and a policy that allows AI-assisted contributions. See them at [donatetokens.org](https://donatetokens.org/#projects) (or [/projects.json](https://donatetokens.org/projects.json)).

Every PR made through TOA says "via TOA" in its AI disclosure and ends with a rough count of the tokens it took. You can see them all, and the running total, at [donatetokens.org/contributions](https://donatetokens.org/contributions).

## Works with

Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot CLI, OpenCode and Amp, including scheduled runs before your reset. Windsurf, Cline and Roo Code get the skill for interactive use.

## Good to know

- **Nothing reports back to TOA.** The installer puts a skill file in your agent tools and keeps your preferences in `~/.toa` on your computer. Your agent reads the public project list; everything else happens between your machine and GitHub.
- **It's your own usage, on your own machine.** TOA doesn't share, pool or resell anything. It only uses what's left before your reset. Check your provider's terms if you're unsure.
- **Quality first.** The agent works help-wanted and bug issues only (never good-first-issues, which stay with human newcomers), follows each project's contribution and AI rules, adds tests, and has a separate agent with fresh context review the diff before any PR opens. Projects whose rules ask for a human review get a draft for your sign-off.
- **Safe to run unattended.** The agent works in its own folder (`~/.toa/work`) with secrets stripped from its environment, and treats everything in a target repo as data, so instructions planted for bots are ignored and flagged to you.
- **Nothing is lost.** Work in progress is pushed to your fork after every step and resumes in your next window.
- **The credit is yours.** PRs come from your own GitHub account, with the AI disclosure each project asks for.

## Commands

| Command | What it does |
|---|---|
| `npx toa-skill` | Interactive setup: find your agent tools, install the skill, pick causes and a window, set up the hourly check |
| `toa-skill check` | Is a subscription inside its window with usage left? |
| `toa-skill run` | Launch due agents headless until usage is spent (`--dry-run` to preview) |
| `toa-skill pick` | Suggest a project and open issues for your preferences |
| `toa-skill history` | The PRs you've opened through TOA and the tokens donated |
| `toa-skill status` | Config, task in progress, last runs |
| `toa-skill schedule` | Install the hourly check (launchd, cron or Task Scheduler); `--remove` to take it out |
| `toa-skill uninstall` | Remove the skill links and the hourly check (`--purge` also removes `~/.toa`) |

After setup, the launcher lives at `~/.toa/bin/toa-skill`. Files: `~/.toa/config.json` (preferences), `~/.toa/state.json` (the task in progress, so the next window resumes it), `~/.toa/skill`, `~/.toa/logs`.

## For maintainers

Want your project listed? Follow and DM [@Gillinghammer on X](https://x.com/Gillinghammer). The bar: an OSI license, clear social impact, merges in the last 60 days, outside PRs that get reviewed, a policy that allows AI-assisted contributions, and issues sized for an agent. Listed projects get a page and a README badge.

## This repository

The source of the [`toa-skill`](https://www.npmjs.com/package/toa-skill) npm package (`bin/`, `lib/`, `skill/`, `test/`) and a ready-to-install copy of the skill in [`skills/toa`](skills/toa/SKILL.md) for `npx skills add`. Run the tests with `node --test test/*.test.mjs`. The website and the curated list live at [donatetokens.org](https://donatetokens.org).

MIT licensed. Not affiliated with Anthropic, OpenAI or GitHub.
