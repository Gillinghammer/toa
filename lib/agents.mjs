// Agent platforms TOA can install its skill into. Skill paths follow the open Agent Skills layout
// (SKILL.md in a folder), matching vercel-labs/skills' agent table; detection checks config dirs and binaries.
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import os from 'node:os';

export function homes(env = process.env) {
  const home = env.TOA_HOME_OVERRIDE || env.HOME || env.USERPROFILE || os.homedir();
  return {
    home,
    config: env.XDG_CONFIG_HOME || join(home, '.config'),
    claude: env.CLAUDE_CONFIG_DIR || join(home, '.claude'),
    codex: env.CODEX_HOME || join(home, '.codex'),
  };
}

export function which(bin, env = process.env) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of String(env.PATH || '').split(delimiter)) {
    for (const ext of exts) { const p = join(dir, bin + ext); if (dir && existsSync(p)) return p; }
  }
  return null;
}

/**
 * id, name, how to detect it, where its global skills live, and (if any) how to run it headless.
 * scheduler: what native scheduling exists today (verified Oct 2026) and whether we can configure it for the user.
 */
export const AGENTS = [
  {
    id: 'claude-code', name: 'Claude Code', bins: ['claude'], dirs: (h) => [h.claude], skills: (h) => join(h.claude, 'skills'),
    // stream-json reports token usage (see tokens.mjs) and still streams progress into the run log.
    headless: { bin: 'claude', args: (prompt, a) => ['-p', prompt, '--output-format', 'stream-json', '--verbose', ...(a.args || ['--permission-mode', 'acceptEdits', '--allowedTools', 'Bash,Read,Edit,Write,Glob,Grep,WebFetch,Task'])] },
    usage: 'claude',
    scheduler: {
      native: 'Claude Code Desktop scheduled tasks (local, hourly, only while the app is open and the computer is awake). Cloud routines (/schedule) run on a fresh clone in the cloud, so they cannot read your local usage or use your gh login.',
      programmatic: false,
      paste: 'In Claude Code Desktop, open any session and say: "Schedule a local task named toa-check that runs hourly with this prompt: Use the toa skill in scheduled mode: run `toa-skill check` and, if it says to run, do the TOA work loop."',
    },
  },
  {
    id: 'codex', name: 'Codex CLI', bins: ['codex'], dirs: (h) => [h.codex, '/etc/codex'], skills: (h) => join(h.home, '.agents', 'skills'),
    headless: { bin: 'codex', args: (prompt, a) => ['exec', '--json', ...(a.args || ['--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true']), prompt] },
    usage: 'codex',
    scheduler: {
      native: 'Codex app scheduled tasks (automations): local or worktree runs while the desktop app is open; created from a chat or the Scheduled pane. The Codex CLI itself has no scheduler.',
      programmatic: false,
      paste: 'In the Codex app, start a chat and say: "Create a standalone scheduled task that runs every hour: $toa run `toa-skill check` and, if it says to run, do the TOA work loop."',
    },
  },
  {
    id: 'cursor', name: 'Cursor', bins: ['cursor-agent', 'cursor'], dirs: (h) => [join(h.home, '.cursor')], skills: (h) => join(h.home, '.cursor', 'skills'),
    headless: { bin: 'cursor-agent', args: (prompt, a) => ['-p', prompt, ...(a.args || ['--force'])] },
    usage: null,
    scheduler: {
      native: 'Cursor Automations: cloud agents on a cron schedule (cursor.com/automations or the /automate skill). They run in a cloud sandbox, not on your machine, and bill Cursor usage.',
      programmatic: false,
      paste: 'Optional: at cursor.com/automations, create an automation with a weekly schedule before your Cursor billing reset and the prompt "Use the toa skill to work on one curated TOA project." Pick your fork as the repository.',
    },
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', bins: ['gemini'], dirs: (h) => [join(h.home, '.gemini')], skills: (h) => join(h.home, '.gemini', 'skills'),
    headless: { bin: 'gemini', args: (prompt, a) => ['-p', prompt, ...(a.args || ['--yolo'])] }, usage: null,
    scheduler: { native: 'None found.', programmatic: false },
  },
  { id: 'opencode', name: 'OpenCode', bins: ['opencode'], dirs: (h) => [join(h.config, 'opencode')], skills: (h) => join(h.config, 'opencode', 'skills'),
    headless: { bin: 'opencode', args: (prompt, a) => ['run', ...(a.args || []), prompt] }, usage: null, scheduler: { native: 'None found.', programmatic: false } },
  { id: 'amp', name: 'Amp', bins: ['amp'], dirs: (h) => [join(h.config, 'amp')], skills: (h) => join(h.config, 'agents', 'skills'),
    headless: { bin: 'amp', args: (prompt, a) => ['-x', prompt, ...(a.args || [])] }, usage: null, scheduler: { native: 'None found.', programmatic: false } },
  { id: 'windsurf', name: 'Windsurf', bins: ['windsurf'], dirs: (h) => [join(h.home, '.codeium', 'windsurf')], skills: (h) => join(h.home, '.codeium', 'windsurf', 'skills'),
    headless: null, usage: null, scheduler: { native: 'None (IDE only).', programmatic: false } },
  { id: 'cline', name: 'Cline', bins: ['cline'], dirs: (h) => [join(h.home, '.cline')], skills: (h) => join(h.home, '.agents', 'skills'),
    headless: null, usage: null, scheduler: { native: 'None (IDE only).', programmatic: false } },
  { id: 'roo', name: 'Roo Code', bins: [], dirs: (h) => [join(h.home, '.roo')], skills: (h) => join(h.home, '.roo', 'skills'),
    headless: null, usage: null, scheduler: { native: 'None (IDE only).', programmatic: false } },
  { id: 'github-copilot', name: 'GitHub Copilot CLI', bins: ['copilot'], dirs: (h) => [join(h.home, '.copilot')], skills: (h) => join(h.home, '.copilot', 'skills'),
    headless: { bin: 'copilot', args: (prompt, a) => ['-p', prompt, ...(a.args || ['--allow-all-tools'])] }, usage: null, scheduler: { native: 'None found.', programmatic: false } },
];

export const agentById = (id) => AGENTS.find((a) => a.id === id) || null;

/** Which agents look installed on this machine, and why. */
export function detectAgents(env = process.env) {
  const h = homes(env);
  return AGENTS.map((a) => {
    const bins = a.bins.map((b) => [b, which(b, env)]).filter(([, p]) => p);
    const dirs = a.dirs(h).filter((d) => existsSync(d));
    return { id: a.id, name: a.name, installed: bins.length > 0 || dirs.length > 0, bins: Object.fromEntries(bins), dirs, skillsDir: a.skills(h),
      headless: !!a.headless && (a.headless ? !!which(a.headless.bin, env) : false), usage: a.usage, scheduler: a.scheduler };
  });
}
