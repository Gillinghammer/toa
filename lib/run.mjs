// The scheduled run: for each agent that should run, launch it headless with the TOA prompt, again and again,
// until it reports nothing to do, hits its usage limit, or reaches max_runs_per_window. State lives in ~/.toa/state.json.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, rmSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { toaDir, loadConfig, loadState, saveState, expandHome } from './config.mjs';
import { agentById } from './agents.mjs';
import { checkAll } from './check.mjs';
import { tokenCounter, withTokenLine, fmtTokens } from './tokens.mjs';

export const NOTHING = 'TOA: nothing to do';
export const LIMIT_RE = /(usage limit|rate limit|limit reached|limit will reset|hit your limit|out of (credits|usage)|quota (exceeded|exhausted)|429 Too Many|usage_limit_reached|5-hour limit|weekly limit)/i;
const SECRET_RE = /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|SESSION|COOKIE|DATABASE_URL|_DSN$|WEBHOOK)/i;
// gh needs its token when it's provided by env; API keys are dropped so CLIs use your subscription, not metered keys.
const KEEP = new Set(['GH_TOKEN', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK']);

/** Environment for the agent: yours minus anything that looks like a secret, plus the per-subscription env. */
export function agentEnv(base, extra = {}, env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(base)) if (KEEP.has(k) || !SECRET_RE.test(k)) out[k] = v;
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete out[k];
  for (const [k, v] of Object.entries(extra || {})) out[k] = expandHome(v, env);
  out.TOA_SCHEDULED = '1';
  return out;
}

export function runPrompt({ name, resetAt, state, cfg }) {
  const when = resetAt ? new Date(resetAt).toLocaleString() : 'unknown';
  const cur = state.current ? `Resume first: ${state.current.repo || state.current.project} issue ${state.current.issue || '?'} on branch ${state.current.branch || '?'} (last step: ${state.current.last_step || '?'}).` : 'No task in progress: pick one per your config.';
  return [
    `Use the TOA skill (~/.toa/skill/SKILL.md) in scheduled mode as agent "${name}".`,
    `Your weekly usage resets at ${when}. Spend what is left of it on TOA work, but don't rush: stopping mid-task is fine.`,
    cur,
    'Commit and push work in progress to your fork branch after every meaningful step, and keep ~/.toa/state.json current.',
    'Open the PR only when the work is done and a separate self-review pass approves it: ready for review by default. Skip donor-signoff projects unless config submit is "ask"; with "ask", open drafts, leave attestation checkboxes for the user, and never mark a draft ready yourself.',
    cfg.max_prs_per_run ? `Open at most ${cfg.max_prs_per_run} pull request${cfg.max_prs_per_run > 1 ? 's' : ''} in this run; after that, update state.json and print "${NOTHING}".` : '',
    `If there is nothing useful to do, print "${NOTHING}" and stop.`,
    cfg.host ? `Curated list: ${cfg.host}/projects.json` : '',
  ].filter(Boolean).join('\n');
}

function lock(env) {
  const p = join(toaDir(env), 'run.lock');
  mkdirSync(toaDir(env), { recursive: true });
  if (existsSync(p)) {
    const { pid, at } = JSON.parse(readFileSync(p, 'utf8') || '{}');
    let alive = false; try { process.kill(pid, 0); alive = true; } catch {}
    if (alive && Date.now() - Date.parse(at) < 6 * 3600e3) return null;
  }
  writeFileSync(p, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  return () => rmSync(p, { force: true });
}

function launch(cmd, args, { cwd, env, timeoutMs, logFile }) {
  return new Promise((resolve) => {
    let out = '';
    const tokens = tokenCounter();
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (d) => { const s = d.toString(); out = (out + s).slice(-200000); appendFileSync(logFile, s); };
    child.stdout.on('data', (d) => { onData(d); tokens.push(d.toString()); });
    child.stderr.on('data', onData);
    const t = setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 10000); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e), error: e, tokens: null }); });
    child.on('close', (code, signal) => { clearTimeout(t); resolve({ code, signal, out, tokens: tokens.total() }); });
  });
}

const prEntries = (st) => [...(st.done || []), ...(st.waiting || [])].filter((e) => e && e.pr);

/**
 * Adds a run's tokens to the totals. A run that opened PRs credits them with everything spent since the previous PR
 * (split evenly), so over time the PR token lines add up to what was donated, including work that never became a PR.
 */
export function creditTokens(st, tokens, fresh) {
  st.tokens = { total: 0, since_last_pr: 0, ...(st.tokens || {}) };
  if (typeof tokens === 'number') { st.tokens.total += tokens; st.tokens.since_last_pr += tokens; }
  if (!fresh.length || !st.tokens.since_last_pr) return [];
  const each = Math.round(st.tokens.since_last_pr / fresh.length);
  st.tokens.since_last_pr = 0;
  for (const e of fresh) e.tokens = each;
  return fresh;
}

const ghSync = (args) => { const r = spawnSync('gh', args, { encoding: 'utf8' }); return r.status === 0 ? r.stdout : null; };

/**
 * Adds (or updates) the "Tokens donated via TOA" line at the end of the PR body. Uses the REST API: `gh pr edit`
 * fails on older gh versions because it still queries the retired Projects (classic) API.
 */
export function annotatePR(url, tokens, { gh = ghSync, env = process.env } = {}) {
  const m = String(url).match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/);
  if (!m) return false;
  const path = `repos/${m[1]}/pulls/${m[2]}`;
  const body = gh(['api', path, '--jq', '.body // ""']);
  if (body == null) return false;
  const file = join(toaDir(env), 'pr-body.md');
  writeFileSync(file, withTokenLine(body, tokens));
  return gh(['api', '-X', 'PATCH', path, '-F', `body=@${file}`, '--silent']) != null;
}

/** Run everything that's due. Options: dryRun (print, don't launch), only (agent name), now, launcher (for tests). */
export async function runDue({ env = process.env, dryRun = false, only = null, log = console.log, launcher = launch, gh = ghSync, now } = {}) {
  const cfg = loadConfig(env);
  const release = dryRun ? () => {} : lock(env);
  if (!release) { log('Another TOA run is in progress; skipping.'); return []; }
  const results = [];
  try {
    const checks = (await checkAll(cfg, loadState(env), { env, now })).filter((c) => !only || c.name === only || c.agent === only);
    for (const c of checks) {
      log(`${c.name}: ${c.run ? 'run' : 'skip'} (${c.reason})`);
      if (!c.run) { results.push(c); continue; }
      const agentCfg = cfg.agents.find((a) => a.name === c.name);
      const def = agentById(agentCfg.agent);
      const cwd = expandHome(cfg.workdir, env);
      const logDir = join(toaDir(env), 'logs');
      if (!dryRun) { mkdirSync(cwd, { recursive: true }); mkdirSync(logDir, { recursive: true }); }
      let runs = 0, stop = null;
      while (!stop && runs < (cfg.max_runs_per_window || 8)) {
        const state = loadState(env);
        const prompt = runPrompt({ name: c.name, resetAt: c.resetAt, state, cfg });
        const args = def.headless.args(prompt, agentCfg);
        if (dryRun) { log(`  would run in ${cwd}: ${def.headless.bin} ${args.map((a) => (a.includes(' ') ? JSON.stringify(a.slice(0, 60) + (a.length > 60 ? '…' : '')) : a)).join(' ')}`); stop = 'dry-run'; break; }
        runs++;
        const known = new Set(prEntries(state).map((e) => e.pr));
        const logFile = join(logDir, `${c.name}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
        const r = await launcher(def.headless.bin, args, { cwd, env: agentEnv(process.env, agentCfg.env, env), timeoutMs: (cfg.run_timeout_minutes || 90) * 60000, logFile });
        if (r.out.includes(NOTHING)) stop = 'nothing to do';
        else if (LIMIT_RE.test(r.out.slice(-4000))) stop = 'usage limit reached';
        else if (r.code !== 0 && !r.signal) stop = `exited with ${r.code}`;
        const st = loadState(env);
        const credited = creditTokens(st, r.tokens, prEntries(st).filter((e) => !known.has(e.pr)));
        for (const e of credited) log(`  ${annotatePR(e.pr, e.tokens, { gh, env }) ? 'added' : 'could not add'} "about ${fmtTokens(e.tokens)} tokens" to ${e.pr}`);
        st.runs = st.runs || {};
        const prev = st.runs[c.name] || {};
        st.runs[c.name] = { ...prev, last_run: new Date().toISOString(), last_result: stop || 'continue', window_reset: c.resetAt ? new Date(c.resetAt).toISOString() : null,
          runs_this_window: prev.window_reset === (c.resetAt && new Date(c.resetAt).toISOString()) ? (prev.runs_this_window || 0) + 1 : 1,
          ...(stop === 'usage limit reached' || stop === 'nothing to do' ? { spent_until: c.resetAt ? new Date(c.resetAt).toISOString() : null } : {}) };
        saveState(st, env);
        log(`  run ${runs}: ${stop || 'finished a step, continuing'}${typeof r.tokens === 'number' ? `, ${fmtTokens(r.tokens)} tokens` : ''} (log: ${logFile})`);
      }
      results.push({ ...c, runs, stop });
    }
  } finally { release(); }
  return results;
}
