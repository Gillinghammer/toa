// Should a configured agent run now? Inside the window before its weekly reset, with usage left, and not already spent this week.
import { usageFor } from './usage.mjs';
import { agentById, which } from './agents.mjs';

export function decide({ usage, cfg, agentCfg, state = {}, now = Date.now() }) {
  const reset = usage?.weekly?.resetAt;
  const used = usage?.weekly?.used;
  const hours = Number(cfg.window_hours) || 24;
  const spent = state.runs?.[agentCfg.name]?.spent_until;
  if (!reset) return { run: false, reason: usage?.note || 'reset time unknown' };
  const left = (reset - now) / 3600000;
  if (left <= 0) return { run: false, reason: 'reset already passed' };
  if (left > hours) return { run: false, reason: `weekly reset in ${left.toFixed(1)}h, outside your ${hours}h window`, resetAt: reset };
  if (spent && Date.parse(spent) >= reset) return { run: false, reason: 'usage already spent for this window', resetAt: reset };
  if (typeof used === 'number' && used >= (cfg.stop_at_percent ?? 98)) return { run: false, reason: `weekly usage at ${used}%`, resetAt: reset };
  return { run: true, reason: `weekly reset in ${left.toFixed(1)}h${typeof used === 'number' ? `, ${Math.round(100 - used)}% left` : ', usage unknown (will run until the CLI reports its limit)'}`, resetAt: reset, used };
}

export async function checkAll(cfg, state, opts = {}) {
  const out = [];
  for (const a of cfg.agents || []) {
    if (!a.enabled || a.run === false) continue;
    const def = agentById(a.agent);
    if (!def?.headless) { out.push({ name: a.name, agent: a.agent, run: false, reason: 'no headless mode; use it interactively' }); continue; }
    if (!which(def.headless.bin, opts.env || process.env)) { out.push({ name: a.name, agent: a.agent, run: false, reason: `${def.headless.bin} not found on PATH` }); continue; }
    const usage = await usageFor(a, def, opts);
    out.push({ name: a.name, agent: a.agent, usage, ...decide({ usage, cfg, agentCfg: a, state, now: opts.now }) });
  }
  return out;
}
