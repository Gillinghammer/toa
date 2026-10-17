#!/usr/bin/env node
// toa-skill: install the TOA agent skill and spend unused AI plan usage on curated open source projects.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { detectAgents, agentById, which } from '../lib/agents.mjs';
import { loadConfig, saveConfig, hasConfig, defaultConfig, agentConfig, loadState, toaDir, configPath, DEFAULT_HOST, WINDOWS } from '../lib/config.mjs';
import { planInstall, applyInstall, uninstallSteps, planStatusline, applyStatusline } from '../lib/install.mjs';
import { planSchedule, applySchedule, removeSchedule } from '../lib/schedule.mjs';
import { checkAll } from '../lib/check.mjs';
import { runDue } from '../lib/run.mjs';
import { recordClaudeStatusline } from '../lib/usage.mjs';
import { fmtTokens } from '../lib/tokens.mjs';
import { fetchProjects, rankProjects, candidateIssues } from '../lib/projects.mjs';
import { rmSync, existsSync } from 'node:fs';

const PKG = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const VALUED = new Set(['--host', '--agents', '--agent', '--name', '--chain', '--project', '--limit']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(VALUED.has(argv[i - 1]) && !argv[i - 1].includes('=')));
const flagVal = (k) => { const i = argv.indexOf(`--${k}`); return flags[k] !== true ? flags[k] : (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const host = (typeof flagVal('host') === 'string' && flagVal('host')) || process.env.TOA_HOST || null;
const cmd = pos[0] || 'setup';
const dry = !!flags['dry-run'];
const json = !!flags.json;

const out = (o) => console.log(JSON.stringify(o, null, 2));
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }) : 'unknown');

const HELP = `toa-skill ${PKG.version}: donate your unused AI plan usage to curated open source projects.

Usage: npx toa-skill [command] [--dry-run]

  (no command)     Interactive setup: detect tools, install the skill, preferences, window, scheduler
  detect           Show which agent tools are installed and where the skill goes
  install          Install the skill without prompts (--agents claude-code,codex | --all-detected) [--copy]
  check            Is any subscription inside its window with usage left? (--json)
  run              Launch due agents headless until usage is spent or nothing is left (--dry-run, --agent <name>)
  status           Config, task in progress, last runs
  history          Pull requests you've opened through TOA and the tokens donated (--json)
  pick             Suggest a project and open issues for your preferences (--json)
  schedule         Install the hourly check (launchd/cron/Task Scheduler) [--remove] [--print]
  statusline       Claude Code status line hook that records usage (set up by the installer)
  uninstall        Remove the skill links and the scheduled job (keeps ~/.toa unless --purge)
`;

function ghStatus() {
  if (!which('gh')) return { ok: false, msg: 'GitHub CLI (gh) not found. Install it: https://cli.github.com' };
  const r = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, msg: 'gh is installed but not logged in. Run: gh auth login' };
  const m = (r.stdout + r.stderr).match(/account ([\w-]+)/i) || (r.stdout + r.stderr).match(/as ([\w-]+)/i);
  return { ok: true, msg: `gh is logged in${m ? ` as ${m[1]}` : ''}` };
}

async function loadCauses(h) {
  try { const list = await fetchProjects(h); return { list, causes: [...new Set(list.projects.flatMap((p) => p.causes || [p.cause]))].sort() }; }
  catch { return { list: null, causes: ['education', 'health', 'accessibility', 'climate', 'financial-inclusion', 'open-knowledge', 'civic', 'humanitarian', 'science'] }; }
}

// -------------------------------------------------------------------------------------------------
async function setup() {
  let p;
  try { p = await import('@clack/prompts'); } catch { console.error('Interactive setup needs @clack/prompts (installed automatically by npx). Use `toa-skill install --all-detected` for a non-interactive install.'); process.exit(1); }
  const cancel = (v) => { if (p.isCancel(v)) { p.cancel('Setup cancelled. Nothing else was changed.'); process.exit(0); } return v; };
  const cfg = hasConfig() ? loadConfig() : defaultConfig();
  if (host) cfg.host = host;

  console.log('');
  p.intro(` TOA · Tokens of Appreciation ${dry ? '(dry run: nothing is written)' : ''}`);
  p.note('Your AI plan resets every week. TOA spends whatever is left, right before the reset,\non open source projects curated for social impact. By default the agent works on its own:\nit claims issues and opens ready-for-review PRs from your GitHub account, with an AI\ndisclosure, after a separate self-review. You can opt out below. No account, no tracking.', 'Welcome');

  const s = p.spinner();
  s.start('Looking for agent tools');
  const found = detectAgents();
  const installed = found.filter((a) => a.installed);
  s.stop(installed.length ? `Found ${installed.map((a) => a.name).join(', ')}` : 'No agent tools found');

  const chosen = cancel(await p.multiselect({
    message: 'Install the TOA skill into:',
    options: found.map((a) => ({ value: a.id, label: a.name, hint: a.installed ? a.skillsDir.replace(process.env.HOME, '~') : 'not detected' })),
    initialValues: installed.map((a) => a.id), required: true,
  }));

  const steps = planInstall(chosen, { copy: !!flags.copy, host: cfg.host });
  s.start('Installing the skill');
  const done = applyInstall(steps, { dryRun: dry });
  s.stop(`Skill ${dry ? 'would be ' : ''}installed (${done.filter((d) => d.agent).length} tool${chosen.length === 1 ? '' : 's'})`);
  const skipped = done.filter((d) => d.skipped);
  if (skipped.length) p.log.warn(skipped.map((d) => d.skipped).join('\n'));

  const { list, causes } = await loadCauses(cfg.host);
  cfg.causes = cancel(await p.multiselect({ message: 'Causes you care about (none = any):', options: causes.map((c) => ({ value: c, label: c.replace(/-/g, ' ') })), initialValues: cfg.causes, required: false }));
  const langs = list ? [...new Set(list.projects.map((x) => x.language).filter(Boolean))].sort() : [];
  if (langs.length) cfg.languages = cancel(await p.multiselect({ message: 'Languages (none = any):', options: langs.map((l) => ({ value: l, label: l })), initialValues: cfg.languages, required: false }));
  if (list) cfg.projects = cancel(await p.multiselect({ message: 'Favourite projects, tried first (optional):', options: rankProjects(list, cfg).map((x) => ({ value: x.slug, label: x.name, hint: (x.causes || []).join(', ') })), initialValues: cfg.projects, required: false }));
  cfg.pick = cancel(await p.select({ message: 'Choosing the project and issue:', options: [{ value: 'auto', label: 'Let the agent pick', hint: 'best for scheduled runs' }, { value: 'ask', label: 'Ask me first', hint: 'in interactive sessions' }], initialValue: cfg.pick }));

  cfg.submit = cancel(await p.select({ message: 'Submitting work upstream:', initialValue: cfg.submit === 'ask' ? 'ask' : 'auto', options: [
    { value: 'auto', label: 'Fully autonomous (default)', hint: 'the agent posts claim comments and opens ready-for-review PRs itself' },
    { value: 'ask', label: 'Ask me before submitting', hint: 'claim comments wait for you; PRs open as drafts for your sign-off' }] }));
  if (cfg.submit === 'auto') p.log.info('Projects whose own rules require a human review still get your sign-off first (shown as "Your sign-off" on donatetokens.org).');

  const win = cancel(await p.select({ message: 'Start spending how long before your weekly reset?', initialValue: WINDOWS.includes(cfg.window_hours) ? cfg.window_hours : 'custom',
    options: [...WINDOWS.map((h) => ({ value: h, label: `${h} hour${h > 1 ? 's' : ''}`, hint: h === 24 ? 'recommended: most room to finish work' : undefined })), { value: 'custom', label: 'Custom' }] }));
  cfg.window_hours = win === 'custom' ? Number(cancel(await p.text({ message: 'Hours before reset:', initialValue: String(cfg.window_hours || 24), validate: (v) => (Number(v) > 0 && Number(v) <= 168 ? undefined : '1 to 168') }))) : win;

  // Subscriptions: one per headless-capable tool; usage source per tool.
  const runnable = chosen.map(agentById).filter((a) => a.headless);
  const prev = new Map((cfg.agents || []).map((a) => [a.name, a]));
  cfg.agents = chosen.map((id) => prev.get(id) || agentConfig(id, { run: !!agentById(id).headless }));
  for (const a of cfg.agents) {
    const def = agentById(a.agent);
    if (!def.headless) continue;
    if (def.usage === 'claude') {
      const hook = cancel(await p.confirm({ message: `${def.name}: record your plan usage from Claude Code's status line? (adds a wrapper; your current status line keeps working)`, initialValue: true }));
      if (hook) { const plan = applyStatusline(planStatusline(a.name, a.env), { dryRun: dry }); p.log.info(plan.already ? 'Status line hook already set.' : `${dry ? 'Would update' : 'Updated'} ${plan.path}${plan.previous ? ' (chained to your existing status line)' : ''}`); }
    }
    const know = def.usage === 'codex' ? 'Codex logs usage in ~/.codex/sessions; newer versions sometimes leave it out.' : def.usage === 'claude' ? 'Used if the status line has no data yet.' : `${def.name} doesn't expose usage, so TOA uses your reset time.`;
    const setReset = cancel(await p.confirm({ message: `${def.name}: set your weekly reset day and time as a fallback? ${know}`, initialValue: !def.usage }));
    if (setReset) {
      const weekday = cancel(await p.select({ message: 'Reset day:', options: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => ({ value: d, label: d })), initialValue: a.usage?.reset?.weekday || 'mon' }));
      const time = cancel(await p.text({ message: 'Reset time (24h, local):', initialValue: a.usage?.reset?.time || '09:00', validate: (v) => (/^\d{1,2}:\d{2}$/.test(v) ? undefined : 'HH:MM') }));
      a.usage = { ...(a.usage || {}), reset: { weekday, time } };
    }
  }

  // Scheduler.
  const plan = planSchedule();
  const nativeNotes = runnable.filter((a) => a.scheduler?.paste).map((a) => `${a.name}: ${a.scheduler.native}\n  ${a.scheduler.paste}`);
  if (runnable.length) {
    const how = cancel(await p.select({ message: 'How should the hourly check run?', options: [
      { value: 'system', label: `${plan.kind} on this computer`, hint: 'recommended: runs headless even with apps closed' },
      ...(nativeNotes.length ? [{ value: 'native', label: 'Native app schedulers', hint: 'paste-ready steps; apps must stay open' }] : []),
      { value: 'none', label: 'Skip for now', hint: 'run `npx toa-skill schedule` later' }] }));
    if (how === 'system') {
      try { applySchedule(plan, { dryRun: dry }); p.log.success(`${dry ? 'Would install' : 'Installed'} the hourly check (${plan.kind}${plan.file ? `: ${plan.file}` : ''})`); }
      catch (e) { p.log.error(`${e.message}\nRun this yourself:\n${plan.kind === 'cron' ? plan.line : plan.commands.join('\n')}`); }
    }
    if (how === 'native' || how === 'system') p.note(nativeNotes.join('\n\n') || 'None of your tools has a scheduler we can use.', how === 'native' ? 'Set up in each app' : 'Optional: native schedulers');
  }

  if (!dry) saveConfig(cfg);
  const gh = ghStatus();
  (gh.ok ? p.log.success : p.log.warn)(gh.msg);

  const lines = [`Skill: ${toaDir()}/skill  →  ${chosen.length} tool(s)`, `Config: ${configPath()}`, `Window: ${cfg.window_hours}h before each weekly reset`,
    `Causes: ${cfg.causes.length ? cfg.causes.join(', ') : 'any'}`, '', 'Try it now in your agent:  "Use the TOA skill to pick a project and start"', 'See what will run:          npx toa-skill check'];
  p.note(lines.join('\n'), dry ? 'Dry run summary' : 'All set');
  p.outro(`Thanks for donating your tokens. ${cfg.host}`);
}

// -------------------------------------------------------------------------------------------------
async function main() {
  if (flags.help || flags.h || cmd === 'help') return console.log(HELP);
  if (flags.version || cmd === 'version') return console.log(PKG.version);

  if (cmd === 'setup') return setup();

  if (cmd === 'detect') {
    const found = detectAgents();
    if (json) return out(found);
    for (const a of found) console.log(`${a.installed ? '●' : '○'} ${a.name.padEnd(20)} ${a.installed ? `skills → ${a.skillsDir}` : 'not detected'}${a.installed && a.headless ? '  (headless)' : ''}`);
    return;
  }

  if (cmd === 'install') {
    const ids = flags['all-detected'] ? detectAgents().filter((a) => a.installed).map((a) => a.id) : String(flagVal('agents') || '').split(',').filter(Boolean);
    if (!ids.length) { console.error('Pass --agents claude-code,codex or --all-detected'); process.exit(2); }
    const done = applyInstall(planInstall(ids, { copy: !!flags.copy, host: host || loadConfig().host }), { dryRun: dry });
    if (!dry && !hasConfig()) { const c = defaultConfig(); if (host) c.host = host; c.agents = ids.map((id) => agentConfig(id, { run: !!agentById(id).headless })); saveConfig(c); }
    if (json) return out(done);
    for (const d of done) console.log(`${dry ? '[dry-run] ' : ''}${d.op.padEnd(6)} ${d.what.padEnd(26)} ${d.to}${d.skipped ? `  (skipped: ${d.skipped})` : ''}`);
    return;
  }

  if (cmd === 'check') {
    const res = await checkAll(loadConfig(), loadState());
    if (json) return out(res);
    if (!res.length) console.log('No subscriptions configured to run. Run `npx toa-skill` to set up.');
    for (const r of res) console.log(`${r.run ? '▶' : '·'} ${r.name.padEnd(14)} ${r.reason}${r.usage?.source ? `  [usage: ${r.usage.source}${r.usage.weekly?.resetAt ? `, resets ${fmtTime(r.usage.weekly.resetAt)}` : ''}]` : ''}`);
    return;
  }

  if (cmd === 'run') { await runDue({ dryRun: dry, only: typeof flagVal('agent') === 'string' ? flagVal('agent') : null }); return; }

  if (cmd === 'status') {
    const cfg = loadConfig(), st = loadState();
    if (json) return out({ config: cfg, state: st });
    console.log(`Config: ${configPath()}${hasConfig() ? '' : ' (not set up yet)'}`);
    console.log(`Window: ${cfg.window_hours}h · pick: ${cfg.pick} · causes: ${cfg.causes.join(', ') || 'any'} · languages: ${cfg.languages.join(', ') || 'any'}`);
    console.log(`In progress: ${st.current ? `${st.current.repo || st.current.project} #${st.current.issue} on ${st.current.branch} (last step: ${st.current.last_step})` : 'nothing'}`);
    for (const [n, r] of Object.entries(st.runs || {})) console.log(`  ${n}: last run ${r.last_run} → ${r.last_result}`);
    return;
  }

  if (cmd === 'history') {
    const st = loadState();
    const prs = [...(st.done || []), ...(st.waiting || [])].filter((e) => e?.pr).sort((a, b) => String(a.at || a.since || '').localeCompare(String(b.at || b.since || '')));
    const total = st.tokens?.total || 0, pending = st.tokens?.since_last_pr || 0;
    if (json) return out({ prs, tokens: { total, since_last_pr: pending } });
    if (!prs.length) console.log('No pull requests through TOA yet.');
    for (const e of prs) console.log(`${String(e.at || e.since || '').slice(0, 10).padEnd(11)}${(e.project || e.repo || '').padEnd(26)}${e.reason === 'signoff' ? 'draft, waiting for you  ' : ''}${e.pr}${e.tokens ? `  ~${fmtTokens(e.tokens)} tokens` : ''}`);
    console.log(`\nTokens donated by scheduled runs: ${total ? `about ${fmtTokens(total)}` : 'none counted yet'}${pending ? ` (${fmtTokens(pending)} since your last PR)` : ''}. Only Claude Code and Codex report usage.`);
    return;
  }

  if (cmd === 'pick') {
    const cfg = loadConfig();
    const ranked = rankProjects(await fetchProjects(host || cfg.host), cfg);
    const target = typeof flagVal('project') === 'string' ? ranked.find((x) => x.slug === flagVal('project')) : ranked[0];
    if (!target) { console.error('No matching project.'); process.exit(1); }
    const issues = await candidateIssues(target, { limit: Number(flags.limit) || 8 });
    if (json) return out({ project: { slug: target.slug, repo: target.repo, automation: target.automation, claim: target.claim }, issues, alternatives: ranked.slice(1, 4).map((x) => x.slug) });
    console.log(`${target.name} (${target.repo}) · ${(target.causes || []).join(', ')} · ${target.automation} · claim: ${target.claim?.rule}`);
    for (const i of issues) console.log(`  #${i.number}  ${i.title}  [${i.labels.join(', ')}]`);
    if (!issues.length) console.log('  No open, unclaimed issues with eligible labels right now.');
    return;
  }

  if (cmd === 'schedule') {
    if (flags.remove) { const r = removeSchedule({ dryRun: dry }); return console.log(`${dry ? '[dry-run] would remove' : 'Removed'} ${r.kind} job`); }
    const plan = planSchedule();
    if (flags.print || dry) { console.log(plan.kind === 'launchd' ? `${plan.file}\n\n${plan.content}\n${plan.commands[0]}` : plan.kind === 'cron' ? plan.line : plan.commands[0]); }
    if (!flags.print && !dry) { applySchedule(plan); console.log(`Installed hourly ${plan.kind} job.`); }
    for (const a of loadConfig().agents.map((x) => agentById(x.agent)).filter((a) => a?.scheduler?.paste)) console.log(`\n${a.name}: ${a.scheduler.native}\n  ${a.scheduler.paste}`);
    return;
  }

  if (cmd === 'statusline') {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    let data = null; try { data = JSON.parse(input); } catch {}
    const name = typeof flagVal('name') === 'string' ? flagVal('name') : 'claude-code';
    try { recordClaudeStatusline(data, name); } catch {}
    const chain = flagVal('chain');
    if (typeof chain === 'string' && chain) { const r = spawnSync('sh', ['-c', chain], { input, encoding: 'utf8' }); process.stdout.write(r.stdout || ''); }
    else if (data?.rate_limits?.seven_day) process.stdout.write(`TOA · week ${Math.round(data.rate_limits.seven_day.used_percentage)}%`);
    return;
  }

  if (cmd === 'uninstall') {
    const cfg = loadConfig();
    const ids = cfg.agents.length ? cfg.agents.map((a) => a.agent) : detectAgents().map((a) => a.id);
    for (const s of uninstallSteps(ids)) if (existsSync(s.to)) { console.log(`${dry ? '[dry-run] ' : ''}remove ${s.to}`); if (!dry) rmSync(s.to, { recursive: true, force: true }); }
    removeSchedule({ dryRun: dry });
    if (flags.purge && !dry) rmSync(toaDir(), { recursive: true, force: true });
    console.log(`${dry ? '[dry-run] would remove' : 'Removed'} the scheduled job${flags.purge ? ' and ~/.toa' : ''}. If you added the Claude status line hook, restore settings.json from settings.json.toa-backup.`);
    return;
  }

  console.error(`Unknown command: ${cmd}\n\n${HELP}`);
  process.exit(2);
}

main().catch((e) => { console.error(`toa-skill: ${e.message}`); process.exit(1); });
