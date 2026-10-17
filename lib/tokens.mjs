// Rough "tokens donated" figures. The runner counts what each headless run reports, and the line it adds to a PR body
// is what donatetokens.org/contributions sums up from public PRs. Shared by the runner and the Worker.
// We count new tokens only: input, cache writes and output. Cache reads are left out: every model call re-reads the
// whole conversation from the prompt cache, so they grow with the number of turns (95% of a typical run), not the work.
//   Claude Code (-p --output-format stream-json): the final `result` event's modelUsage, summed over models
//     (input + cache write + output, subagents included).
//   Codex (exec --json): every `turn.completed` usage event, uncached input (input - cached input) + output.
// Other CLIs don't report usage, so their runs count as unknown (null).

const claudeTotal = (o) => {
  const per = o.modelUsage && Object.values(o.modelUsage);
  if (per?.length) return per.reduce((n, m) => n + (m.inputTokens || 0) + (m.outputTokens || 0) + (m.cacheCreationInputTokens || 0), 0);
  const u = o.usage || {};
  return (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
};

/** Counts tokens from streamed CLI output. push() takes raw chunks (lines may split across them); total() is a number or null. */
export function tokenCounter() {
  let buf = '', claude = null, codex = 0, sawCodex = false;
  const line = (l) => {
    if (l[0] !== '{') return;
    let o; try { o = JSON.parse(l); } catch { return; }
    if (o.type === 'result' && (o.modelUsage || o.usage)) claude = (claude || 0) + claudeTotal(o);
    else if (o.type === 'turn.completed' && o.usage) { sawCodex = true; codex += Math.max(0, (o.usage.input_tokens || 0) - (o.usage.cached_input_tokens || 0)) + (o.usage.output_tokens || 0); }
  };
  return {
    push(chunk) { buf += chunk; const parts = buf.split('\n'); buf = parts.pop(); for (const p of parts) line(p.trim()); },
    total() { if (buf) { line(buf.trim()); buf = ''; } return claude ?? (sawCodex ? codex : null); },
  };
}

export const tokensFromOutput = (out) => { const c = tokenCounter(); c.push(String(out ?? '')); return c.total(); };

export const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

export const TOKEN_LINE = 'Tokens donated via TOA:';
const LINE_RE = /^Tokens donated via TOA: about ([\d.]+)([kM]?)\b.*$/m;

/** The PR body with exactly one token line at the end. */
export function withTokenLine(body, tokens) {
  const clean = String(body || '').replace(new RegExp(LINE_RE.source, 'gm'), '').replace(/\s+$/, '');
  return `${clean}\n\n${TOKEN_LINE} about ${fmtTokens(tokens)}\n`;
}

/** The token figure from a PR body, or null when it has no token line. */
export function parseTokenLine(body) {
  const m = String(body || '').match(LINE_RE);
  return m ? Math.round(Number(m[1]) * (m[2] === 'M' ? 1e6 : m[2] === 'k' ? 1e3 : 1)) : null;
}
