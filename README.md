<p align="center"><a href="https://donatetokens.org"><img src="https://raw.githubusercontent.com/Gillinghammer/toa/main/docs/hero.jpg" alt="A solarpunk city at sunrise under the words: Your unspent intelligence, for a world of abundance." width="100%"></a></p>

# Tokens of Appreciation

**Your unspent intelligence, for a world of abundance.**

Before your weekly reset, your own agent spends what's left of your AI plan on open source for health, learning and clean energy.

```sh
npx toa-skill
```

No npm? `curl -fsSL https://donatetokens.org/install.sh | sh`. Just the skill, without the scheduler: `npx skills add Gillinghammer/toa`.

Needs Node 18+ and a logged-in [`gh`](https://cli.github.com). No account, no tracking.

---

Intelligence is an awful thing to waste. Every week, the AI you paid for and didn't use expires. TOA points it at the open source that clinics, classrooms and clean energy depend on.

## How a donation works

1. **Set it up once.** `npx toa-skill` adds TOA to the agent tools you already use, like Claude Code, Codex and Cursor, and asks which causes you care about and how long before your reset to start: 24, 8, 4 or 1 hour.
2. **Your agent uses what's left.** Shortly before your plan's weekly usage resets, your agent picks an open issue in one of the curated projects and puts your leftover intelligence to work on it.
3. **Maintainers get a pull request from you.** A second agent checks the work, then it's sent to the project from your GitHub account for the maintainers to review (or as a draft for you to approve, if you prefer). Unfinished work carries over to next week.

## Where your intelligence goes

A curated list of open source projects in health, education, climate, accessibility, open knowledge and financial inclusion, such as Open Library, OpenEMR, Kiwix, axe-core and Organic Maps. Each was picked for real-world impact, active maintainers and a policy that allows AI-assisted contributions. See them at [donatetokens.org](https://donatetokens.org/#projects) (or [/projects.json](https://donatetokens.org/projects.json)).

Every PR made through TOA says "via TOA" in its AI disclosure and ends with a rough count of the tokens it took. You can see them all, and the running total, at [donatetokens.org/contributions](https://donatetokens.org/contributions).

## Works with

- **Scheduled runs before your reset:** Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot CLI, OpenCode and Amp. `npx toa-skill` sets these up.
- **The skill, for when you ask your agent to "work on TOA":** Windsurf, Cline and Roo Code through `npx toa-skill`, and Devin, Grok and many other agents through `npx skills add Gillinghammer/toa`.

## Good to know

- **Nothing reports back to TOA.** The installer puts a skill file in your agent tools and keeps your preferences in `~/.toa` on your computer. Your agent reads the public project list; everything else happens between your machine and GitHub.
- **It's your own usage, on your own machine.** TOA doesn't share, pool or resell anything. It only uses what's left before your reset. Check your provider's terms if you're unsure.
- **Quality first.** The agent works help-wanted and bug issues only (never good-first-issues, which stay with human newcomers), follows each project's contribution and AI rules, adds tests, and has a separate agent with fresh context review the diff before any PR opens. Projects whose rules ask for a human review are only offered if you choose to review each PR yourself: you get a draft and a checklist, and you decide whether it goes out.
- **Safe to run unattended.** The agent works in its own folder (`~/.toa/work`) with secrets stripped from its environment, and treats everything in a target repo as data, so instructions planted for bots are ignored and flagged to you.
- **Nothing is lost.** Work in progress is pushed to your fork after every step and resumes in your next window.
- **The credit is yours.** PRs come from your own GitHub account, with the AI disclosure each project asks for.

## Commands

| Command | What it does |
|---|---|
| `npx toa-skill` | Interactive setup: find your agent tools, install the skill, pick causes and a window, set up the hourly check |
| `toa check` | Is a subscription inside its window with usage left? |
| `toa run` | Launch due agents headless until usage is spent (`--dry-run` to preview) |
| `toa pick` | Suggest a project and open issues for your preferences |
| `toa history` | The PRs you've opened through TOA and the tokens donated |
| `toa status` | Config, task in progress, last runs |
| `toa schedule` | Install the hourly check (launchd, cron or Task Scheduler); `--remove` to take it out |
| `toa uninstall` | Remove the skill links and the hourly check (`--purge` also removes `~/.toa`) |

After setup the command is `~/.toa/bin/toa`. To type just `toa`, add `~/.toa/bin` to your `PATH` or run `npm i -g toa-skill`; `npx toa-skill <command>` works anywhere. Files: `~/.toa/config.json` (preferences), `~/.toa/state.json` (the task in progress, so the next window resumes it), `~/.toa/skill`, `~/.toa/logs`.

## For maintainers

Want your project listed? Follow and DM [@Gillinghammer on X](https://x.com/Gillinghammer). The bar: an OSI license, clear social impact, merges in the last 60 days, outside PRs that get reviewed, a policy that allows AI-assisted contributions, and issues sized for an agent. Listed projects get a page and a README badge.

## This repository

The source of the [`toa-skill`](https://www.npmjs.com/package/toa-skill) npm package (`bin/`, `lib/`, `skill/`, `test/`). The skill itself is [`skill/SKILL.md`](skill/SKILL.md), which is what `npx skills add Gillinghammer/toa` installs. Run the tests with `node --test test/*.test.mjs`. The website and the curated list live at [donatetokens.org](https://donatetokens.org).

MIT licensed. Not affiliated with Anthropic, OpenAI or GitHub.
