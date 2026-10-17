import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tokenCounter, tokensFromOutput, fmtTokens, withTokenLine, parseTokenLine } from '../lib/tokens.mjs';
import { creditTokens, annotatePR, runPrompt } from '../lib/run.mjs';
import { agentById } from '../lib/agents.mjs';

// Trimmed from real `claude -p --output-format stream-json --verbose` and `codex exec --json` output.
const CLAUDE = [
  '{"type":"system","subtype":"init","model":"claude"}',
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","overageDisabledReason":"out_of_credits"}}',
  '{"type":"result","subtype":"success","result":"OK","usage":{"input_tokens":2,"output_tokens":4},"modelUsage":{"opus":{"inputTokens":2,"outputTokens":4,"cacheReadInputTokens":10834,"cacheCreationInputTokens":17740},"haiku":{"inputTokens":100,"outputTokens":50,"cacheReadInputTokens":0,"cacheCreationInputTokens":0}}}',
].join('\n');
const CODEX = [
  '{"type":"thread.started","thread_id":"t"}',
  '{"type":"turn.completed","usage":{"input_tokens":16776,"cached_input_tokens":13184,"output_tokens":5}}',
  '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":0,"output_tokens":20}}',
].join('\n');

test('tokens: new tokens only (no cache reads), summed across models and Codex turns; others are unknown', () => {
  assert.equal(tokensFromOutput(CLAUDE), 2 + 4 + 17740 + 150, 'Claude: input + output + cache writes, not the 10834 cache reads');
  assert.equal(tokensFromOutput(CODEX), (16776 - 13184) + 5 + 1000 + 20, 'Codex: uncached input + output');
  assert.equal(tokensFromOutput('plain text output from another CLI\nTOA: nothing to do'), null);
});

test('tokens: counting survives lines split across stream chunks', () => {
  const c = tokenCounter();
  for (let i = 0; i < CODEX.length; i += 7) c.push(CODEX.slice(i, i + 7));
  assert.equal(c.total(), (16776 - 13184) + 5 + 1000 + 20);
});

test('tokens: one PR line, parsed back to the same rough figure', () => {
  assert.equal(fmtTokens(2_437_000), '2.4M');
  assert.equal(fmtTokens(48_200), '48k');
  const body = withTokenLine(withTokenLine('Fixes #12\n\nAI disclosure: prepared via TOA.', 1_000_000), 2_437_000);
  assert.equal(body.match(/Tokens donated via TOA/g).length, 1);
  assert.ok(body.startsWith('Fixes #12'));
  assert.equal(parseTokenLine(body), 2_400_000);
  assert.equal(parseTokenLine('no line here'), null);
});

test('tokens: a run that opens PRs credits everything since the previous PR', () => {
  const st = { done: [], waiting: [] };
  creditTokens(st, 500, []);
  assert.deepEqual(st.tokens, { total: 500, since_last_pr: 500 });
  const a = { pr: 'https://github.com/o/r/pull/1' }, b = { pr: 'https://github.com/o/r/pull/2' };
  assert.equal(creditTokens(st, 1500, [a, b]).length, 2);
  assert.equal(a.tokens, 1000); assert.equal(b.tokens, 1000);
  assert.deepEqual(st.tokens, { total: 2000, since_last_pr: 0 });
  assert.equal(creditTokens(st, null, [{ pr: 'x' }]).length, 0, 'nothing counted, nothing credited');
});

test('tokens: annotatePR rewrites the body through gh', () => {
  const calls = [];
  const gh = (args) => { calls.push(args); return args.includes('PATCH') ? '' : 'Body\n\nAI disclosure: via TOA.\n'; };
  const env = { TOA_DIR: mkdtempSync(join(tmpdir(), 'toa-')) };
  assert.equal(annotatePR('https://github.com/o/r/pull/9', 1_200_000, { gh, env }), true);
  assert.deepEqual(calls[0].slice(0, 2), ['api', 'repos/o/r/pulls/9'], 'reads through REST, not gh pr view');
  assert.deepEqual(calls[1].slice(0, 4), ['api', '-X', 'PATCH', 'repos/o/r/pulls/9']);
  assert.match(readFileSync(join(env.TOA_DIR, 'pr-body.md'), 'utf8'), /Tokens donated via TOA: about 1\.2M\n$/);
  assert.equal(annotatePR('https://github.com/o/r/pull/9', 1, { gh: () => null, env }), false);
  assert.equal(annotatePR('not a PR url', 1, { gh, env }), false);
});

test('headless runs ask Claude Code and Codex for machine-readable usage; the PR cap reaches the prompt', () => {
  assert.ok(agentById('claude-code').headless.args('p', {}).join(' ').includes('--output-format stream-json --verbose'));
  assert.equal(agentById('codex').headless.args('p', {})[1], '--json');
  assert.match(runPrompt({ name: 'c', state: {}, cfg: { max_prs_per_run: 1 } }), /Open at most 1 pull request in this run/);
  assert.doesNotMatch(runPrompt({ name: 'c', state: {}, cfg: {} }), /Open at most/);
});

test('scheduler PATH keeps the user dirs but not the temporary npx ones', async () => {
  const { planSchedule } = await import('../lib/schedule.mjs');
  const env = { HOME: '/Users/u', TOA_DIR: '/Users/u/.toa', PATH: '/Users/u/.npm/_npx/abc/node_modules/.bin:/tmp/x/node_modules/.bin:/opt/homebrew/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin:/Users/u/.local/bin:/usr/bin' };
  const plan = planSchedule({ env, platform: 'darwin' });
  assert.match(plan.content, /\/Users\/u\/\.local\/bin/);
  assert.doesNotMatch(plan.content, /_npx|node_modules\/\.bin|node-gyp-bin/);
});
