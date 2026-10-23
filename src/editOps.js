// Pure text transformations on note contents. No `vscode` import, so they can be unit-tested with plain Node.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FENCE_RE = /^\s*(```|~~~)/;

/** Applies `fn(line)` to every line outside fenced code blocks; keeps the original line endings. */
function mapOutsideFences(text, fn) {
  const parts = text.split(/(\r?\n)/);
  let inFence = false;
  for (let i = 0; i < parts.length; i += 2) {
    if (FENCE_RE.test(parts[i])) { inFence = !inFence; continue; }
    if (!inFence) parts[i] = fn(parts[i]);
  }
  return parts.join('');
}

/** [[Old]], [[Old|alias]], [[Old#heading]] → same with newName. Case-insensitive; returns { text, count }. */
function renameLinks(text, oldName, newName) {
  let count = 0;
  const re = new RegExp(`\\[\\[\\s*${escapeRe(oldName)}(?:\\.md)?\\s*((?:[#|][^\\]]*)?)\\]\\]`, 'gi');
  const out = mapOutsideFences(text, (line) => line.replace(re, (m, rest) => { count++; return `[[${newName}${rest}]]`; }));
  return { text: out, count };
}

/** #old → #new (also #old/child → #new/child). Skips headings' leading '#', URL fragments and code fences. */
function renameTag(text, oldTag, newTag) {
  let count = 0;
  const re = new RegExp(`(^|[\\s,;])#${escapeRe(oldTag)}(?=$|[^\\w-]|/)`, 'gi');
  const out = mapOutsideFences(text, (line) => line.replace(re, (m, pre) => { count++; return `${pre}#${newTag}`; }));
  return { text: out, count };
}

const TASK_RE = /^(\s*[-*+]\s+)\[( |x|X)\](\s+.*)?$/;
const DONE_STAMP_RE = /\s+✓\s*\d{4}-\d{2}-\d{2}\s*$/;

/** Flips a task line. When completing and `stampDate` is given, appends "✓ date"; unchecking removes it. */
function toggleTaskLine(line, stampDate) {
  const m = TASK_RE.exec(line);
  if (!m) return null;
  const done = m[2] !== ' ';
  let rest = m[3] || '';
  if (done) return `${m[1]}[ ]${rest.replace(DONE_STAMP_RE, '')}`;
  if (stampDate && !DONE_STAMP_RE.test(rest)) rest = `${rest.replace(/\s+$/, '')} ✓ ${stampDate}`;
  return `${m[1]}[x]${rest}`;
}

/**
 * Moves completed top-level tasks (with their indented sub-lines) into a "## {heading}" section at the end,
 * under a "### {date}" subheading. Returns { text, moved }.
 */
function archiveCompleted(text, { heading = 'Completed', date }) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const headingRe = new RegExp(`^##\\s+${escapeRe(heading)}\\s*$`, 'i');
  let archiveStart = lines.findIndex(l => headingRe.test(l));
  let archiveEnd = lines.length;
  if (archiveStart >= 0) {
    const next = lines.findIndex((l, i) => i > archiveStart && /^#{1,2}\s/.test(l));
    if (next >= 0) archiveEnd = next;
  }
  const keep = [], moved = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) inFence = !inFence;
    const inArchive = archiveStart >= 0 && i >= archiveStart && i < archiveEnd;
    const m = !inFence && !inArchive && /^([-*+]\s+)\[(x|X)\]/.exec(line); // top level only
    if (!m) { keep.push(line); continue; }
    const block = [line];
    // Indented lines below a task (notes, sub-tasks) travel with it
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i]);
    moved.push(...block);
  }
  if (!moved.length) return { text, moved: 0 };

  // Re-locate the archive section in the kept lines and insert under "### date"
  let start = keep.findIndex(l => headingRe.test(l));
  if (start < 0) {
    while (keep.length && keep[keep.length - 1].trim() === '') keep.pop();
    keep.push('', `## ${heading}`);
    start = keep.length - 1;
  }
  let end = keep.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  if (end < 0) end = keep.length;
  const sub = `### ${date}`;
  let subAt = keep.findIndex((l, i) => i > start && i < end && l.trim() === sub);
  if (subAt < 0) {
    keep.splice(start + 1, 0, '', sub, ...moved);
  } else {
    let insertAt = subAt + 1;
    while (insertAt < end && keep[insertAt].trim() !== '' && !/^#{1,3}\s/.test(keep[insertAt])) insertAt++;
    keep.splice(insertAt, 0, ...moved);
  }
  return { text: keep.join(eol).replace(/(\r?\n)*$/, eol), moved: moved.filter(l => /^[-*+]\s+\[/.test(l)).length };
}

// ---------- Kanban ----------

/**
 * Board = "## Heading" sections that contain task lines. Text before the first "##" with tasks becomes
 * a column named by `untitled`. Cards are top-level task lines (plus indented sub-lines).
 */
function parseBoard(text, untitled = 'Tasks') {
  const lines = text.split(/\r?\n/);
  const columns = [];
  let col = { title: untitled, line: -1, cards: [] };
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (FENCE_RE.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(l);
    if (h) { columns.push(col); col = { title: h[1], line: i, cards: [] }; continue; }
    const m = /^([-*+]\s+)\[( |x|X)\]\s*(.*)$/.exec(l);
    if (m) {
      let end = i;
      while (end + 1 < lines.length && /^\s+\S/.test(lines[end + 1])) end++;
      col.cards.push({ line: i, endLine: end, done: m[2] !== ' ', text: m[3] });
      i = end;
    }
  }
  columns.push(col);
  return columns.filter(c => c.line >= 0 || c.cards.length);
}

/** Moves the card starting at `cardLine` to the end of column `toIndex` (as returned by parseBoard). */
function moveCard(text, cardLine, toIndex, { doneColumn } = {}) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const cols = parseBoard(text);
  const card = cols.flatMap(c => c.cards).find(c => c.line === cardLine);
  const target = cols[toIndex];
  if (!card || !target) throw new Error('card or column not found');
  let block = lines.slice(card.line, card.endLine + 1);
  if (doneColumn !== undefined) {
    const done = target.title.toLowerCase() === String(doneColumn).toLowerCase();
    block[0] = block[0].replace(/^([-*+]\s+)\[( |x|X)\]/, `$1[${done ? 'x' : ' '}]`);
  }
  // Insertion point: after the target column's last card, else right after its heading
  const last = target.cards.filter(c => c.line !== card.line).pop();
  let insertAt = last ? last.endLine + 1 : target.line + 1;
  if (!last && target.line >= 0 && lines[insertAt] !== undefined && lines[insertAt].trim() === '') insertAt++;
  if (!last && target.line < 0) insertAt = 0;
  lines.splice(card.line, block.length);
  if (insertAt > card.line) insertAt -= block.length;
  lines.splice(insertAt, 0, ...block);
  return lines.join(eol);
}

// ---------- Calendar ----------

/** Weeks (arrays of 7 Date|null) for a month; weeks start on `weekStart` (0 = Sunday, 1 = Monday). */
function monthGrid(year, month, weekStart = 1) {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() - weekStart + 7) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1))];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

module.exports = { renameLinks, renameTag, toggleTaskLine, archiveCompleted, parseBoard, moveCard, monthGrid, mapOutsideFences };
