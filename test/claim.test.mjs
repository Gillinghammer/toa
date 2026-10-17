import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNotReady, recentlyClaimed } from '../lib/projects.mjs';

test('not-ready labels are skipped', () => {
  for (const l of ['Needs: Lead', 'Needs: Triage', 'needs discussion', 'needs-design', 'blocked', 'on hold', 'status: in progress'])
    assert.equal(isNotReady([l]), true, l);
  for (const l of ['bug', 'help wanted', 'Type: Bug', 'Theme: Search', 'good first issue'])
    assert.equal(isNotReady([{ name: l }]), false, l);
});

test('recent claim comments from others block the issue', () => {
  const now = Date.parse('2026-10-17T15:00:00Z');
  const c = (login, body, createdAt) => ({ author: { login }, body, createdAt });
  assert.equal(recentlyClaimed([c('someone', "Hi, I'd like to help with this issue. Could I be assigned this issue?", '2026-10-17T06:38:17Z')], { now }), true);
  assert.equal(recentlyClaimed([c('someone', 'Can I work on this?', '2026-08-01T00:00:00Z')], { now }), false, 'older than 30 days');
  assert.equal(recentlyClaimed([c('Gillinghammer', 'Could I be assigned?', '2026-10-17T06:00:00Z')], { now, self: 'gillinghammer' }), false, 'own claim');
  assert.equal(recentlyClaimed([c('openlibrary-bot', 'I would like to help', '2026-10-17T06:00:00Z')], { now }), false, 'bots');
  assert.equal(recentlyClaimed([c('someone', 'This also happens on Firefox.', '2026-10-17T06:00:00Z')], { now }), false);
});

test('SKILL.md documents claim-first and the unclaimed checks', () => {
  const s = readFileSync(new URL('../skill/SKILL.md', import.meta.url), 'utf8');
  assert.match(s, /Claim it first/);
  assert.match(s, /never open the PR until the user is assigned/);
  assert.match(s, /last 30 days/);
  assert.match(s, /Needs: Lead/);
  assert.match(s, /"comment_url"/);
});
