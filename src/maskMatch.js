// Pure pattern matching for masking. No `vscode` import, so it can be unit-tested with plain Node.

/** Compiles patterns; capture group 1 (if present) is the part that gets hidden, otherwise the whole match. */
function compile(patterns) {
  const out = [];
  for (const p of patterns || []) {
    try { out.push(new RegExp(p, 'gi')); }
    catch (err) { console.warn(`[notes-explorer] invalid mask pattern ${p}: ${err.message}`); }
  }
  return out;
}

function findMasked(text, regexes) {
  const ranges = [];
  for (const re of regexes) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (!m[0]) continue;
      const value = m[1] !== undefined ? m[1] : m[0];
      if (!value) continue;
      const start = m.index + (m[1] !== undefined ? m[0].indexOf(m[1]) : 0);
      ranges.push({ start, end: start + value.length, value });
    }
  }
  return ranges;
}

module.exports = { compile, findMasked };
