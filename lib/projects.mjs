// Fetch the curated list and suggest a project + issue that fit the user's preferences.
import { execFileSync } from 'node:child_process';
import { which } from './agents.mjs';

export async function fetchProjects(host, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`${host.replace(/\/$/, '')}/projects.json`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`projects.json: HTTP ${res.status}`);
  return res.json();
}

/**
 * Order projects: preferred first, then cause and language matches. Excluded ones are dropped, and so are projects whose
 * rules require a human review of every PR (donor-signoff) unless the donor reviews PRs themselves (submit: "ask").
 */
export function rankProjects(list, cfg) {
  const projects = list.projects || list;
  const reviews = cfg.submit === 'ask';
  const pref = (cfg.projects || []).map((s) => s.toLowerCase());
  const causes = new Set(cfg.causes || []);
  const langs = new Set((cfg.languages || []).map((l) => l.toLowerCase()));
  const excluded = new Set(cfg.exclude_projects || []);
  return projects.filter((p) => !excluded.has(p.slug) && (reviews || p.automation !== 'donor-signoff')).map((p) => {
    const pi = pref.indexOf(p.slug);
    const causeHit = (p.causes || [p.cause]).some((c) => causes.has(c));
    const langHit = langs.has(String(p.language || '').toLowerCase());
    const score = (pi >= 0 ? 100 - pi : 0) + (causes.size ? (causeHit ? 10 : -20) : 0) + (langs.size ? (langHit ? 5 : -5) : 0);
    return { ...p, _score: score };
  }).sort((a, b) => b._score - a._score);
}

/** Labels that mean "not ready for outside work yet": needs a lead, triage, discussion, design, a decision, or is blocked. */
export const NOT_READY_LABEL = /\b(needs?|awaiting|pending)[\s:_-]*(lead|triage|discussion|design|decision|breakdown|response|reproduction|repro|info|feedback|approval)\b|\b(blocked|on[\s-]?hold|wontfix|won't fix|duplicate|invalid|question|discussion|in[\s-]?progress|claimed)\b/i;
export const isNotReady = (labels) => (labels || []).some((l) => NOT_READY_LABEL.test(String(l.name || l)));

/** A comment that asks to take the issue ("can I be assigned", "I'd like to work on this", "I'm on it", "/assign"). */
export const CLAIM_COMMENT = /\b(assign (it|this)( issue)? to me|(can|could|may) i (be assigned|work on|take|pick)|i('d| would) (like|love) to (work on|take|help with|tackle|pick)|i('m| am) (working on|on it|taking)|i('ll| will) (work on|take|pick)|please assign|\/assign)\b/i;
/** True if someone other than `self` asked to claim the issue within `days` (default 30). */
export function recentlyClaimed(comments, { self = '', days = 30, now = Date.now() } = {}) {
  const cutoff = now - days * 864e5;
  return (comments || []).some((c) => {
    const who = String(c.author?.login || c.user?.login || '').toLowerCase();
    if (who && who === String(self).toLowerCase()) return false;
    if (/\[bot\]$|-bot$/.test(who)) return false;
    const at = Date.parse(c.createdAt || c.created_at || 0);
    return at >= cutoff && CLAIM_COMMENT.test(String(c.body || ''));
  });
}

const searchQuery = (repo, label) => `repo:${repo} is:issue is:open no:assignee -linked:pr label:"${label}"`;

/** Open, unassigned, un-PR'd issues with an eligible label (gh if authenticated, else the public search API). */
export async function candidateIssues(project, { limit = 10, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const labels = project.eligible_labels?.target || ['help wanted', 'bug'];
  const avoid = new Set((project.eligible_labels?.avoid || []).map((l) => l.toLowerCase()));
  const seen = new Map();
  const ghOk = which('gh', env) && (() => { try { execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  let searches = 0, failed = 0;
  for (const repo of project.repos?.length ? project.repos : [project.repo]) {
    for (const label of labels) {
      let items = [];
      searches++;
      if (ghOk) {
        try { items = JSON.parse(execFileSync('gh', ['api', '-X', 'GET', 'search/issues', '-f', `q=${searchQuery(repo, label)}`, '-f', 'sort=updated', '-f', `per_page=${limit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).items || []; } catch { failed++; }
      } else {
        const res = await fetchImpl(`https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery(repo, label))}&sort=updated&per_page=${limit}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'toa-skill' } }).catch(() => null);
        if (res?.ok) items = (await res.json()).items || []; else failed++;
      }
      for (const i of items) {
        const names = (i.labels || []).map((l) => (l.name || l).toLowerCase());
        if (names.some((n) => avoid.has(n)) || isNotReady(names)) continue;
        seen.set(i.html_url, { repo, number: i.number, title: i.title, url: i.html_url, labels: names, comments: i.comments, updated_at: i.updated_at });
      }
    }
  }
  // An empty list must mean "no eligible issues", never "GitHub refused the search".
  if (searches && failed === searches) throw new Error('GitHub issue search failed (often a rate limit). Try again in a few minutes.');
  return [...seen.values()].sort((a, b) => a.comments - b.comments || String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, limit);
}
