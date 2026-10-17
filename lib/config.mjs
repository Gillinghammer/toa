// ~/.toa/config.json and ~/.toa/state.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homes } from './agents.mjs';

export const DEFAULT_HOST = 'https://donatetokens.org';
export const WINDOWS = [24, 8, 4, 1];

export const toaDir = (env = process.env) => env.TOA_DIR || join(homes(env).home, '.toa');
export const configPath = (env) => join(toaDir(env), 'config.json');
export const statePath = (env) => join(toaDir(env), 'state.json');

export function defaultConfig() {
  return {
    host: DEFAULT_HOST,
    causes: [],                 // e.g. ["health", "education"]; empty = any
    languages: [],              // e.g. ["Python", "TypeScript"]; empty = any
    projects: [],               // preferred project slugs, tried first
    exclude_projects: [],
    pick: 'auto',               // "auto": the agent picks; "ask": it asks you in interactive sessions
    submit: 'auto',             // "auto" (default): the agent posts claim comments and opens ready-for-review PRs by itself;
                                // "ask": ask me before submitting (claim comments wait for me, PRs open as drafts)
    window_hours: 24,           // run when a weekly reset is within this many hours (24, 8, 4, 1, or custom)
    stop_at_percent: 98,        // stop launching runs once a window is this full (when usage is readable)
    max_runs_per_window: 8,
    max_prs_per_run: null,      // stop a scheduled run after opening this many PRs (null = no cap)
    run_timeout_minutes: 90,
    workdir: '~/.toa/work',
    agents: [],                 // filled by the installer, see agentConfig()
  };
}

/** Per agent/subscription. Add one entry per subscription (e.g. two Claude accounts via CLAUDE_CONFIG_DIR). */
export function agentConfig(id, extra = {}) {
  return {
    name: id, agent: id, enabled: true, run: true,
    env: {},                    // e.g. { "CLAUDE_CONFIG_DIR": "~/.claude-work" } or { "CODEX_HOME": "~/.codex-work" }
    args: null,                 // override headless args
    usage: { source: 'auto', reset: null },  // reset fallback: { "weekday": "thu", "time": "09:00" } (local time)
    oauth_usage: false,         // Claude only, opt-in: read /api/oauth/usage with your stored login (undocumented endpoint)
    ...extra,
  };
}

const read = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
function writeAtomic(p, data) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, p);
}

export const loadConfig = (env) => ({ ...defaultConfig(), ...read(configPath(env), {}) });
export const saveConfig = (cfg, env) => writeAtomic(configPath(env), cfg);
export const hasConfig = (env) => existsSync(configPath(env));

/**
 * state.json is written by the agent while it works (see SKILL.md) and read by the runner.
 * { current: { project, repo, issue, fork, branch, last_step, notes, updated_at } | null, done: [...], waiting: [...], runs: {...} }
 */
export const loadState = (env) => ({ current: null, done: [], waiting: [], runs: {}, ...read(statePath(env), {}) });
export const saveState = (st, env) => writeAtomic(statePath(env), st);

export const expandHome = (p, env = process.env) => String(p || '').replace(/^~(?=$|\/)/, homes(env).home);
