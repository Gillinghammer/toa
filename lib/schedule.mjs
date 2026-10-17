// The catch-all hourly check: launchd (macOS), cron (Linux), Task Scheduler (Windows).
// Native per-tool schedulers can't be configured from outside the app today, so the installer prints paste-ready steps for them.
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { toaDir } from './config.mjs';
import { homes } from './agents.mjs';

export const LABEL = 'dev.toa.check';
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A Node path that survives upgrades: Homebrew's versioned Cellar path (process.execPath) breaks on `brew upgrade node`. */
export function stableNode(execPath = process.execPath, exists = existsSync) {
  if (process.platform === 'win32') return execPath;
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) if (exists(p)) return p;
  return execPath;
}
export const runtimePath = (env = process.env) => join(toaDir(env), 'runtime', 'bin', 'toa-skill.mjs');

export function launcherPath(env = process.env) { return join(toaDir(env), 'bin', process.platform === 'win32' ? 'toa.cmd' : 'toa'); }

export function launchdPlist({ node, runtime, path, logDir }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(runtime)}</string><string>run</string><string>--scheduled</string></array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><false/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
  <key>StandardOutPath</key><string>${xml(join(logDir, 'scheduler.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logDir, 'scheduler.log'))}</string>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
</dict></plist>
`;
}

export const cronLine = ({ launcher, path, logDir, minute = 7 }) => `${minute} * * * * PATH=${path} ${launcher} run --scheduled >> ${join(logDir, 'scheduler.log')} 2>&1 # toa-skill`;

/** What we'd install on this OS. */
export function planSchedule({ env = process.env, platform = process.platform } = {}) {
  const launcher = launcherPath(env);
  const logDir = join(toaDir(env), 'logs');
  const node = stableNode();
  // Keep the user's PATH (where claude, codex and gh live) minus the temporary dirs npx adds while installing.
  const keep = (p) => p && !/node_modules\/\.bin$|\/_npx\/|node-gyp-bin/.test(p);
  const path = [...new Set([dirname(node), ...String(env.PATH || '').split(':').filter(keep), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])].join(':');
  if (platform === 'darwin') {
    const file = join(homes(env).home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    return { kind: 'launchd', file, content: launchdPlist({ node, runtime: runtimePath(env), path, logDir }), logDir, commands: [`launchctl bootout gui/$(id -u) ${file} 2>/dev/null; launchctl bootstrap gui/$(id -u) ${file}`] };
  }
  if (platform === 'win32') {
    return { kind: 'schtasks', logDir, commands: [`schtasks /Create /F /SC HOURLY /TN "TOA check" /TR "\\"${launcher}\\" run --scheduled"`] };
  }
  return { kind: 'cron', line: cronLine({ launcher, path, logDir }), logDir, commands: ['(crontab -l 2>/dev/null | grep -v "# toa-skill"; echo "<line>") | crontab -'] };
}

export function applySchedule(plan, { dryRun = false } = {}) {
  if (dryRun) return { ...plan, dryRun: true };
  mkdirSync(plan.logDir, { recursive: true });
  if (plan.kind === 'launchd') {
    mkdirSync(dirname(plan.file), { recursive: true });
    writeFileSync(plan.file, plan.content);
    const uid = String(process.getuid());
    spawnSync('launchctl', ['bootout', `gui/${uid}`, plan.file], { stdio: 'ignore' });
    const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plan.file], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`launchctl bootstrap failed: ${r.stderr || r.status}`);
  } else if (plan.kind === 'cron') {
    const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
    const lines = (cur.status === 0 ? cur.stdout : '').split('\n').filter((l) => l && !l.includes('# toa-skill'));
    lines.push(plan.line);
    const r = spawnSync('crontab', ['-'], { input: lines.join('\n') + '\n', encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`crontab failed: ${r.stderr || r.status}`);
  } else if (plan.kind === 'schtasks') {
    execFileSync('cmd', ['/c', plan.commands[0]], { stdio: 'inherit' });
  }
  return plan;
}

export function removeSchedule({ env = process.env, platform = process.platform, dryRun = false } = {}) {
  const plan = planSchedule({ env, platform });
  if (dryRun) return plan;
  if (plan.kind === 'launchd') { spawnSync('launchctl', ['bootout', `gui/${process.getuid()}`, plan.file], { stdio: 'ignore' }); if (existsSync(plan.file)) rmSync(plan.file); }
  else if (plan.kind === 'cron') {
    const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
    if (cur.status === 0) spawnSync('crontab', ['-'], { input: cur.stdout.split('\n').filter((l) => !l.includes('# toa-skill')).join('\n'), encoding: 'utf8' });
  } else spawnSync('schtasks', ['/Delete', '/F', '/TN', 'TOA check'], { stdio: 'ignore' });
  return plan;
}
