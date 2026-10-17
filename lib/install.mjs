import { stableNode } from './schedule.mjs';
// Installing the skill: one canonical copy in ~/.toa, linked (or copied) into each chosen agent's skills folder,
// plus a self-contained runtime (~/.toa/runtime) and launcher (~/.toa/bin/toa-skill) for scheduled runs.
import { mkdirSync, cpSync, existsSync, symlinkSync, rmSync, lstatSync, writeFileSync, readFileSync, chmodSync, readlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toaDir, expandHome, DEFAULT_HOST } from './config.mjs';
import { agentById, homes } from './agents.mjs';

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL_NAME = 'toa';

/** Plan the writes (for dry runs and the summary). */
export function planInstall(agentIds, { env = process.env, copy = false, host = DEFAULT_HOST } = {}) {
  const dir = toaDir(env);
  const canonical = join(dir, 'skill');
  const steps = [{ op: 'copy', from: join(PKG_ROOT, 'skill'), to: canonical, what: 'skill (canonical copy)', host },
    { op: 'copy', from: PKG_ROOT, to: join(dir, 'runtime'), what: 'runtime for scheduled runs' },
    { op: 'write', to: join(dir, 'bin', process.platform === 'win32' ? 'toa-skill.cmd' : 'toa-skill'), what: 'launcher' }];
  const seen = new Set();
  for (const id of agentIds) {
    const a = agentById(id);
    if (!a) continue;
    const target = join(a.skills(homes(env)), SKILL_NAME);
    if (seen.has(target)) { steps.push({ op: 'shared', agent: id, to: target, what: `${a.name} (shares this folder)` }); continue; }
    seen.add(target);
    steps.push({ op: copy || process.platform === 'win32' ? 'copy' : 'link', agent: id, from: canonical, to: target, what: a.name });
  }
  return steps;
}

export function applyInstall(steps, { dryRun = false } = {}) {
  const done = [];
  for (const s of steps) {
    if (dryRun || s.op === 'shared') { done.push({ ...s, dryRun }); continue; }
    if (s.op === 'copy') {
      if (s.from === PKG_ROOT) {
        rmSync(s.to, { recursive: true, force: true });
        mkdirSync(s.to, { recursive: true });
        for (const part of ['bin', 'lib', 'skill', 'package.json']) if (existsSync(join(PKG_ROOT, part))) cpSync(join(PKG_ROOT, part), join(s.to, part), { recursive: true });
      } else {
        if (existsSync(s.to) && lstatSync(s.to).isSymbolicLink()) rmSync(s.to);
        mkdirSync(dirname(s.to), { recursive: true });
        cpSync(s.from, s.to, { recursive: true, force: true });
        if (s.host) for (const f of ['SKILL.md', 'config.example.json', 'install.sh']) {
          const fp = join(s.to, f);
          if (existsSync(fp)) writeFileSync(fp, readFileSync(fp, 'utf8').replaceAll('{{TOA_HOST}}', s.host.replace(/\/$/, '')));
        }
      }
    } else if (s.op === 'link') {
      mkdirSync(dirname(s.to), { recursive: true });
      if (existsSync(s.to) || isDanglingLink(s.to)) {
        const st = lstatSync(s.to);
        if (st.isSymbolicLink()) rmSync(s.to);
        else { done.push({ ...s, skipped: `${s.to} exists and is not a TOA link; left it alone` }); continue; }
      }
      symlinkSync(s.from, s.to, 'dir');
    } else if (s.op === 'write') {
      mkdirSync(dirname(s.to), { recursive: true });
      const runtime = join(dirname(dirname(s.to)), 'runtime', 'bin', 'toa-skill.mjs');
      if (process.platform === 'win32') writeFileSync(s.to, `@echo off\r\n"${process.execPath}" "${runtime}" %*\r\n`);
      else { writeFileSync(s.to, `#!/bin/sh\n# TOA launcher: runs the installed runtime with a stable Node path.\nexec "${stableNode()}" "${runtime}" "$@"\n`); chmodSync(s.to, 0o755); }
    }
    done.push(s);
  }
  return done;
}

function isDanglingLink(p) { try { readlinkSync(p); return true; } catch { return false; } }

/** Remove TOA from agent folders (only links/copies we made) and the scheduled job is handled by schedule.mjs. */
export function uninstallSteps(agentIds, { env = process.env } = {}) {
  return agentIds.map((id) => agentById(id)).filter(Boolean).map((a) => ({ op: 'remove', agent: a.id, to: join(a.skills(homes(env)), SKILL_NAME) }));
}

// ---- Claude Code status line hook (usage snapshots) -----------------------------------------------
export const claudeSettingsPath = (agentEnv = {}, env = process.env) => join(expandHome(agentEnv.CLAUDE_CONFIG_DIR || '', env) || homes(env).claude, 'settings.json');

/** Wrap the user's status line so Claude Code's rate_limits get recorded; the previous command keeps rendering. */
export function planStatusline(name, agentEnv = {}, { env = process.env } = {}) {
  const p = claudeSettingsPath(agentEnv, env);
  let settings = {};
  try { settings = JSON.parse(readFileSync(p, 'utf8')); } catch {}
  const prev = settings.statusLine?.command || '';
  if (prev.includes('toa-skill statusline')) return { path: p, already: true };
  const launcher = join(toaDir(env), 'bin', 'toa-skill');
  const command = `${launcher} statusline --name ${name}${prev ? ` --chain ${JSON.stringify(prev)}` : ''}`;
  return { path: p, settings: { ...settings, statusLine: { ...(settings.statusLine || {}), type: 'command', command } }, previous: prev || null };
}
export function applyStatusline(plan, { dryRun = false } = {}) {
  if (dryRun || plan.already) return plan;
  mkdirSync(dirname(plan.path), { recursive: true });
  if (existsSync(plan.path)) cpSync(plan.path, `${plan.path}.toa-backup`);
  writeFileSync(plan.path, JSON.stringify(plan.settings, null, 2) + '\n');
  return plan;
}
