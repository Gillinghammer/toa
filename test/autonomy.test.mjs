import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { defaultConfig } from '../lib/config.mjs';
import { runPrompt } from '../lib/run.mjs';

// The curated list lives with the site; in the standalone toa-skill repo these checks are skipped.
const listUrl = new URL('../../../projects.json', import.meta.url);
const list = existsSync(listUrl) ? JSON.parse(readFileSync(listUrl, 'utf8')) : null;
const needsList = list ? {} : { skip: 'projects.json lives with the site (donatetokens.org/projects.json)' };
const skill = readFileSync(new URL('../skill/SKILL.md', import.meta.url), 'utf8');

test('autonomous is the default; donors can opt out with submit: ask', () => {
  if (list) assert.equal(list.defaults.automation, 'autonomous');
  assert.equal(defaultConfig().submit, 'auto');
  assert.match(skill, /config\.submit == "ask"/);
});

test('sign-off projects say why', needsList, () => {
  for (const p of list.projects.filter((x) => x.automation === 'donor-signoff')) assert.ok(p.automation_reason, p.slug);
});

test('autonomous disclosures never claim a human review', needsList, () => {
  assert.doesNotMatch(list.defaults.disclosure.pr_section, /reviewed by @/);
  for (const p of list.projects.filter((x) => x.automation === 'autonomous')) {
    const d = (p.disclosure?.pr_section || list.defaults.disclosure.pr_section);
    assert.doesNotMatch(d, /reviewed by @|reviewed before submission/i, p.slug);
    assert.match(d, /autonomously/i, p.slug);
  }
  assert.match(skill, /self-reviewed by the agent/);
});

test('autonomous PRs open ready for review; drafts only in sign-off mode', () => {
  assert.match(skill, /ready for review, no draft/);
  assert.match(runPrompt({ name: 'claude-code', state: { current: null }, cfg: {} }), /ready for review by default/);
});
