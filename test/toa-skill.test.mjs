import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, existsSync, readlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectAgents } from '../lib/agents.mjs';
import { planInstall, applyInstall, planStatusline, applyStatusline } from '../lib/install.mjs';
import { recordClaudeStatusline, claudeSnapshot, codexSnapshot, nextManualReset, usageFor } from '../lib/usage.mjs';
import { decide } from '../lib/check.mjs';
import { agentEnv, runDue, runPrompt, NOTHING } from '../lib/run.mjs';
import { saveConfig, defaultConfig, agentConfig, loadState, saveState } from '../lib/config.mjs';
import { planSchedule, launchdPlist } from '../lib/schedule.mjs';
import { rankProjects } from '../lib/projects.mjs';

const H = 3600e3;
function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'toa-home-'));
  const bin = join(home, 'bin'); mkdirSync(bin);
  return { home, bin, env: { HOME: home, PATH: bin, TOA_DIR: join(home, '.toa') } };
}
const fakeBin = (dir, name) => { writeFileSync(join(dir, name), '#!/bin/sh\n'); chmodSync(join(dir, name), 0o755); };

test('detects agents from config dirs and binaries in a fake HOME', () => {
  const { home, bin, env } = fakeHome();
  mkdirSync(join(home, '.claude')); fakeBin(bin, 'codex'); mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  const found = Object.fromEntries(detectAgents(env).map((a) => [a.id, a]));
  assert.equal(found['claude-code'].installed, true);
  assert.equal(found['claude-code'].skillsDir, join(home, '.claude', 'skills'));
  assert.equal(found.codex.installed, true);
  assert.equal(found.codex.headless, true);
  assert.equal(found.codex.skillsDir, join(home, '.agents', 'skills'));
  assert.equal(found.opencode.installed, true);
  assert.equal(found.cursor.installed, false);
  assert.equal(detectAgents({ ...env, CLAUDE_CONFIG_DIR: join(home, 'alt') }).find((a) => a.id === 'claude-code').skillsDir, join(home, 'alt', 'skills'));
});

test('install: one canonical copy, symlinked per agent, shared folders deduped, host filled in', () => {
  const { home, env } = fakeHome();
  const steps = planInstall(['claude-code', 'codex', 'cline'], { env, host: 'https://example.org' });
  assert.equal(steps.find((s) => s.agent === 'cline').op, 'shared');
  applyInstall(steps);
  const canon = join(home, '.toa', 'skill');
  assert.match(readFileSync(join(canon, 'SKILL.md'), 'utf8'), /^---\nname: toa\n/);
  assert.ok(readFileSync(join(canon, 'SKILL.md'), 'utf8').includes('https://example.org/projects.json'));
  assert.ok(!readFileSync(join(canon, 'SKILL.md'), 'utf8').includes('{{TOA_HOST}}'));
  assert.ok(lstatSync(join(home, '.claude', 'skills', 'toa')).isSymbolicLink());
  assert.equal(readlinkSync(join(home, '.agents', 'skills', 'toa')), canon);
  assert.ok(existsSync(join(home, '.toa', 'runtime', 'bin', 'toa-skill.mjs')));
  assert.match(readFileSync(join(home, '.toa', 'bin', 'toa-skill'), 'utf8'), /runtime\/bin\/toa-skill\.mjs/);
  // A user's own folder of the same name is left alone.
  mkdirSync(join(home, '.cursor', 'skills', 'toa'), { recursive: true });
  const r = applyInstall(planInstall(['cursor'], { env }).filter((s) => s.agent));
  assert.match(r[0].skipped, /not a TOA link/);
  // Dry run writes nothing.
  const d = fakeHome();
  applyInstall(planInstall(['claude-code'], { env: d.env }), { dryRun: true });
  assert.ok(!existsSync(join(d.home, '.toa')));
});

test('Claude status line hook chains the existing command and records rate limits', () => {
  const { home, env } = fakeHome();
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'x', statusLine: { type: 'command', command: 'my-line' } }));
  const plan = applyStatusline(planStatusline('claude-code', {}, { env }));
  const s = JSON.parse(readFileSync(plan.path, 'utf8'));
  assert.equal(s.model, 'x');
  assert.match(s.statusLine.command, /toa-skill statusline --name claude-code --chain "my-line"/);
  assert.ok(existsSync(`${plan.path}.toa-backup`));
  assert.ok(planStatusline('claude-code', {}, { env }).already);
  const now = Date.parse('2026-10-17T12:00:00Z');
  assert.ok(recordClaudeStatusline({ rate_limits: { five_hour: { used_percentage: 20, resets_at: now / 1000 + 3600 }, seven_day: { used_percentage: 61.5, resets_at: now / 1000 + 5 * 3600 } } }, 'claude-code', env, now));
  const snap = claudeSnapshot('claude-code', env);
  assert.equal(snap.weekly.used, 61.5);
  assert.equal(snap.weekly.resetAt, now + 5 * H);
  assert.equal(recordClaudeStatusline({ model: {} }, 'claude-code', env), false, 'no rate_limits (API key users, before first response)');
});

test('Codex rollout logs: weekly window by window_minutes, null snapshots skipped', () => {
  const { home, env } = fakeHome();
  const dir = join(home, '.codex', 'sessions', '2026', '10', '17'); mkdirSync(dir, { recursive: true });
  const t = '2026-10-17T10:00:00Z';
  const ev = (rl) => JSON.stringify({ timestamp: t, type: 'event_msg', payload: { type: 'token_count', info: {}, rate_limits: rl } });
  writeFileSync(join(dir, 'rollout-2026-10-17T10-00-00-abc.jsonl'), [
    ev({ primary: { used_percent: 12, window_minutes: 300, resets_in_seconds: 3600 }, secondary: { used_percent: 44, window_minutes: 10080, resets_at: 1792000000 }, plan_type: 'plus' }),
    ev(null),
  ].join('\n'));
  const s = codexSnapshot({}, env);
  assert.equal(s.weekly.used, 44);
  assert.equal(s.weekly.resetAt, 1792000000 * 1000);
  assert.equal(s.session.resetAt, Date.parse(t) + 3600e3);
  assert.equal(s.plan, 'plus');
  assert.equal(codexSnapshot({ CODEX_HOME: join(home, 'none') }, env), null);
});

test('manual reset fallback and stale snapshots', async () => {
  const now = new Date(2026, 9, 17, 10, 0).getTime(); // Sat 10:00 local
  assert.equal(new Date(nextManualReset({ weekday: 'sat', time: '12:00' }, now)).getHours(), 12);
  assert.equal(nextManualReset({ weekday: 'sat', time: '09:00' }, now) - now > 6 * 24 * H, true);
  assert.equal(nextManualReset({ weekday: 'mon', time: '09:00' }, now), new Date(2026, 9, 19, 9, 0).getTime());
  const { env } = fakeHome();
  const u = await usageFor(agentConfig('gemini-cli', { usage: { reset: { weekday: 'sat', time: '20:00' } } }), { usage: null }, { env, now });
  assert.equal(u.source, 'manual');
  const none = await usageFor(agentConfig('gemini-cli'), { usage: null }, { env, now });
  assert.equal(none.weekly, null);
});

test('decide: only inside the window, with usage left, once per window', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const cfg = { window_hours: 8, stop_at_percent: 98 };
  const a = { name: 'claude-code' };
  assert.equal(decide({ usage: { weekly: { resetAt: now + 10 * H, used: 30 } }, cfg, agentCfg: a, now }).run, false);
  assert.equal(decide({ usage: { weekly: { resetAt: now + 6 * H, used: 30 } }, cfg, agentCfg: a, now }).run, true);
  assert.equal(decide({ usage: { weekly: { resetAt: now + 6 * H, used: 99 } }, cfg, agentCfg: a, now }).run, false);
  assert.equal(decide({ usage: { weekly: { resetAt: now + 6 * H, used: null } }, cfg, agentCfg: a, now }).run, true, 'unknown usage still runs; the CLI reports its limit');
  const spent = { runs: { 'claude-code': { spent_until: new Date(now + 6 * H).toISOString() } } };
  assert.equal(decide({ usage: { weekly: { resetAt: now + 6 * H, used: 50 } }, cfg, agentCfg: a, state: spent, now }).run, false);
  assert.equal(decide({ usage: { weekly: null, note: 'x' } , cfg, agentCfg: a, now }).run, false);
});

test('agent environment drops secrets and API keys but keeps gh auth', () => {
  const e = agentEnv({ PATH: '/bin', HOME: '/h', AWS_SECRET_ACCESS_KEY: 's', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', GH_TOKEN: 'g', STRIPE_API_KEY: 'x', DATABASE_URL: 'pg://' }, { CLAUDE_CONFIG_DIR: '~/.claude-work' }, { HOME: '/h' });
  assert.deepEqual(Object.keys(e).sort(), ['CLAUDE_CONFIG_DIR', 'GH_TOKEN', 'HOME', 'PATH', 'TOA_SCHEDULED']);
  assert.equal(e.CLAUDE_CONFIG_DIR, '/h/.claude-work');
});

test('run: resumes state in the prompt, loops until the limit, records spent window', async () => {
  const { home, bin, env } = fakeHome();
  fakeBin(bin, 'claude');
  const now = Date.now();
  const cfg = { ...defaultConfig(), window_hours: 24, workdir: join(home, 'work'), agents: [agentConfig('claude-code', { usage: { reset: null } })] };
  saveConfig(cfg, env);
  recordClaudeStatusline({ rate_limits: { seven_day: { used_percentage: 40, resets_at: Math.floor((now + 5 * H) / 1000) } } }, 'claude-code', env, now);
  saveState({ current: { repo: 'kiwix/kiwix-js', issue: 12, branch: 'toa/12-fix', last_step: 'tests written' } }, env);
  const calls = [];
  const launcher = async (cmd, args, o) => { calls.push({ cmd, args, cwd: o.cwd, env: o.env }); return calls.length < 2 ? { code: 0, out: 'did a step' } : { code: 1, out: 'Claude usage limit reached. Your limit will reset at 5pm' }; };
  const prevPath = process.env.PATH; process.env.PATH = `${bin}:${prevPath}`;
  try {
    const r = await runDue({ env, launcher, log: () => {}, now });
    assert.equal(calls.length, 2);
    assert.equal(r[0].stop, 'usage limit reached');
    assert.equal(calls[0].cmd, 'claude');
    assert.equal(calls[0].args[0], '-p');
    assert.match(calls[0].args[1], /Resume first: kiwix\/kiwix-js issue 12 on branch toa\/12-fix/);
    assert.equal(calls[0].env.TOA_SCHEDULED, '1');
    const st = loadState(env);
    assert.equal(st.runs['claude-code'].spent_until, new Date(Math.floor((now + 5 * H) / 1000) * 1000).toISOString());
    calls.length = 0;
    await runDue({ env, launcher, log: () => {}, now });
    assert.equal(calls.length, 0, 'spent window does not rerun');
  } finally { process.env.PATH = prevPath; }
  assert.match(runPrompt({ name: 'x', resetAt: null, state: {}, cfg: {} }), new RegExp(NOTHING));
});

test('schedule plans: launchd plist runs the launcher hourly, cron line is tagged', () => {
  const { env } = fakeHome();
  const mac = planSchedule({ env, platform: 'darwin' });
  assert.equal(mac.kind, 'launchd');
  assert.match(mac.content, /<key>StartInterval<\/key><integer>3600<\/integer>/);
  assert.match(mac.content, /<string>[^<]*\/node<\/string><string>[^<]*\.toa\/runtime\/bin\/toa-skill\.mjs<\/string><string>run<\/string><string>--scheduled/);
  const linux = planSchedule({ env, platform: 'linux' });
  assert.match(linux.line, /^7 \* \* \* \* PATH=.* run --scheduled >> .*scheduler\.log 2>&1 # toa-skill$/);
  assert.match(launchdPlist({ node: '/a&b', runtime: '/r', path: '/bin', logDir: '/l' }), /\/a&amp;b/);
});

test('rankProjects: favourites first, then causes and languages', () => {
  const list = { projects: [{ slug: 'a', causes: ['climate'], language: 'Go' }, { slug: 'b', causes: ['health'], language: 'Python' }, { slug: 'c', causes: ['health'], language: 'Java' }] };
  assert.deepEqual(rankProjects(list, { causes: ['health'], languages: ['Python'] }).map((p) => p.slug), ['b', 'c', 'a']);
  assert.equal(rankProjects(list, { projects: ['a'], causes: ['health'] })[0].slug, 'a');
  assert.ok(!rankProjects(list, { exclude_projects: ['b'] }).some((p) => p.slug === 'b'));
});
