// Reading plan usage and the next weekly reset, per agent CLI. Every source is best effort; see README "Usage detection".
//   Claude Code: rate_limits passed to status line scripts (documented, v2.1.80+), recorded by `toa-skill statusline`;
//                optional /api/oauth/usage (undocumented, opt-in). Codex: rate_limits in ~/.codex/sessions rollout logs.
//   Everything else, or when those are missing: the reset day/time you set.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { toaDir, expandHome } from './config.mjs';
import { homes } from './agents.mjs';

const WEEK_MIN = 10000; // windows at least this long (minutes) are the weekly one (10080)

export const snapshotPath = (name, env) => join(toaDir(env), 'usage', `${name}.json`);

/** Called by `toa-skill statusline`: keep Claude's latest rate_limits for the hourly check. */
export function recordClaudeStatusline(input, name = 'claude-code', env = process.env, now = Date.now()) {
  const rl = input?.rate_limits;
  if (!rl) return false;
  mkdirSync(join(toaDir(env), 'usage'), { recursive: true });
  writeFileSync(snapshotPath(name, env), JSON.stringify({ source: 'claude-statusline', at: new Date(now).toISOString(), rate_limits: rl }, null, 2));
  return true;
}

const toMs = (v) => (v === null || v === undefined ? null : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v) || null);

/** Normalize to { weekly: { used, resetAt }, session: {...}, source, at } */
export function fromClaudeRateLimits(rl, at, source) {
  const w = rl?.seven_day, s = rl?.five_hour;
  const used = (x) => (x ? x.used_percentage ?? x.utilization ?? null : null);
  return { source, at, weekly: w ? { used: used(w), resetAt: toMs(w.resets_at) } : null, session: s ? { used: used(s), resetAt: toMs(s.resets_at) } : null };
}

export function claudeSnapshot(name, env) {
  const p = snapshotPath(name, env);
  if (!existsSync(p)) return null;
  try { const j = JSON.parse(readFileSync(p, 'utf8')); return fromClaudeRateLimits(j.rate_limits, Date.parse(j.at), j.source); } catch { return null; }
}

/** Opt-in: Claude's own usage endpoint (what /usage shows). Reads your stored login read-only; never logs or stores the token. */
export async function claudeOauthUsage(agentEnv, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  let token = null;
  const dir = expandHome(agentEnv.CLAUDE_CONFIG_DIR || '', env) || homes(env).claude;
  try { token = JSON.parse(readFileSync(join(dir, '.credentials.json'), 'utf8'))?.claudeAiOauth?.accessToken; } catch {}
  if (!token && process.platform === 'darwin') {
    try { token = JSON.parse(execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))?.claudeAiOauth?.accessToken; } catch {}
  }
  if (!token) return null;
  const res = await fetchImpl('https://api.anthropic.com/api/oauth/usage', { headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' } }).catch(() => null);
  if (!res?.ok) return null;
  const j = await res.json().catch(() => null);
  if (!j) return null;
  const weekly = j.seven_day || (j.limits || []).find((l) => l.kind === 'weekly_all');
  return fromClaudeRateLimits({ seven_day: weekly && { utilization: weekly.utilization ?? weekly.percent, resets_at: weekly.resets_at }, five_hour: j.five_hour }, Date.now(), 'claude-oauth-usage');
}

/** Codex: the newest non-null rate_limits snapshot in rollout logs. */
export function codexSnapshot(agentEnv = {}, env = process.env, { maxFiles = 40 } = {}) {
  const root = join(expandHome(agentEnv.CODEX_HOME || '', env) || homes(env).codex, 'sessions');
  if (!existsSync(root)) return null;
  const files = [];
  const walk = (d, depth) => { for (const f of readdirSync(d)) { const p = join(d, f); const st = statSync(p); if (st.isDirectory() && depth < 4) walk(p, depth + 1); else if (/^rollout-.*\.jsonl$/.test(f)) files.push([p, st.mtimeMs]); } };
  try { walk(root, 0); } catch { return null; }
  files.sort((a, b) => b[1] - a[1]);
  for (const [p] of files.slice(0, maxFiles)) {
    const lines = readFileSync(p, 'utf8').trim().split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('rate_limits')) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      const rl = ev?.payload?.rate_limits || ev?.rate_limits;
      if (!rl) continue;
      const at = Date.parse(ev.timestamp) || statSync(p).mtimeMs;
      const wins = [rl.primary, rl.secondary].filter(Boolean).map((w) => ({ used: w.used_percent, minutes: w.window_minutes,
        resetAt: w.resets_at ? toMs(w.resets_at) : w.resets_in_seconds !== undefined ? at + w.resets_in_seconds * 1000 : null }));
      const weekly = wins.find((w) => (w.minutes || 0) >= WEEK_MIN);
      const session = wins.find((w) => (w.minutes || 0) < WEEK_MIN);
      return { source: 'codex-rollout', at, plan: rl.plan_type || null, limitReached: rl.rate_limit_reached_type || null, weekly: weekly ? { used: weekly.used, resetAt: weekly.resetAt } : null, session: session ? { used: session.used, resetAt: session.resetAt } : null };
    }
  }
  return null;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** Next occurrence of a user-set weekly reset ({ weekday: 'thu', time: '09:00' }, local time). */
export function nextManualReset(reset, now = Date.now()) {
  if (!reset?.weekday) return null;
  const wd = DAYS.indexOf(String(reset.weekday).slice(0, 3).toLowerCase());
  if (wd < 0) return null;
  const [hh, mm] = String(reset.time || '00:00').split(':').map(Number);
  const d = new Date(now);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh || 0, mm || 0, 0, 0);
  let add = (wd - t.getDay() + 7) % 7;
  if (add === 0 && t.getTime() <= now) add = 7;
  t.setDate(t.getDate() + add);
  return t.getTime();
}

/**
 * Usage for one configured agent: { source, weekly: { used, resetAt }, stale, note }.
 * A snapshot whose weekly reset already passed is stale (the window rolled over since it was taken).
 */
export async function usageFor(agentCfg, def, { env = process.env, now = Date.now(), fetchImpl } = {}) {
  let snap = null;
  if (def?.usage === 'claude') {
    if (agentCfg.oauth_usage) snap = await claudeOauthUsage(agentCfg.env || {}, { fetchImpl, env });
    snap = snap || claudeSnapshot(agentCfg.name, env);
  } else if (def?.usage === 'codex') snap = codexSnapshot(agentCfg.env || {}, env);
  if (snap?.weekly?.resetAt && snap.weekly.resetAt > now) return { ...snap, stale: false };
  const manual = nextManualReset(agentCfg.usage?.reset, now);
  if (manual) return { source: 'manual', weekly: { used: snap?.weekly?.resetAt > now ? snap.weekly.used : null, resetAt: manual }, stale: false, note: snap ? `last ${snap.source} snapshot is stale` : 'no usage signal; using your reset day/time' };
  return { source: snap ? `${snap.source} (stale)` : 'none', weekly: null, stale: true, note: 'No usage signal and no reset day/time set. Set usage.reset in ~/.toa/config.json.' };
}
