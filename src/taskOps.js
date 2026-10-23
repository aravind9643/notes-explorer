// Inserting tasks into notes and carrying unfinished tasks between daily notes. No `vscode` import.

const FENCE_RE = /^\s*(```|~~~)/;
const SECTION_RE = /^(#{2,6})\s+(.+?)\s*#*\s*$/;
const OPEN_TOP_TASK_RE = /^[-*+]\s+\[ \]\s+(.*)$/;
const EXAMPLE_RE = /^_e\.g\./i;

/** "## Heading" sections (level 2+) with their line ranges: [{ title, line, end }] (end is exclusive). */
function sections(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let inFence = false;
  lines.forEach((l, i) => {
    if (FENCE_RE.test(l)) inFence = !inFence;
    const m = !inFence && SECTION_RE.exec(l);
    if (m) {
      if (out.length) out[out.length - 1].end = i;
      out.push({ title: m[2], level: m[1].length, line: i, end: lines.length });
    }
  });
  return out;
}

/**
 * Inserts "- [ ] text" into a note: at the end of the task list in `section` (by title), or in the first
 * section that has tasks, or — if the note has no tasks yet — after the last line. Returns { text, line }.
 */
function insertTask(noteText, taskLine, section) {
  const eol = noteText.includes('\r\n') ? '\r\n' : '\n';
  const lines = noteText.split(/\r?\n/);
  const secs = sections(noteText);
  const isTask = (l) => /^\s*[-*+]\s+\[[ xX]\]/.test(l);
  const hasTasks = (s) => lines.slice(s.line + 1, s.end).some(isTask);
  const target = (section && secs.find(s => s.title.toLowerCase() === section.toLowerCase())) || secs.find(hasTasks) || null;

  let at;
  if (target) {
    // After the last task (or its indented sub-lines) in the section, else right below the heading
    at = target.line + 1;
    for (let i = target.line + 1; i < target.end; i++) {
      if (isTask(lines[i])) { at = i + 1; while (at < target.end && /^\s+\S/.test(lines[at])) at++; }
    }
    if (at === target.line + 1) {
      if (lines[at] !== undefined && lines[at].trim() === '') at++;
      // Keep a blank line between the new task and the next heading
      if (lines[at] !== undefined && SECTION_RE.test(lines[at])) lines.splice(at, 0, '');
    }
  } else {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length && !isTask(lines[lines.length - 1])) lines.push('');
    at = lines.length;
  }
  lines.splice(at, 0, taskLine);
  let out = lines.join(eol);
  if (!out.endsWith(eol)) out += eol;
  return { text: out, line: at };
}

/**
 * Takes the open top-level tasks (and their indented sub-lines) out of a note, skipping template examples
 * and tasks in an "Archive"/"Completed" section. Returns { remaining, tasks: [lines…], count }.
 */
function takeOpenTasks(noteText) {
  const eol = noteText.includes('\r\n') ? '\r\n' : '\n';
  const lines = noteText.split(/\r?\n/);
  const keep = [], taken = [];
  let count = 0, inFence = false, skipSection = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (FENCE_RE.test(l)) inFence = !inFence;
    const h = !inFence && SECTION_RE.exec(l);
    if (h) skipSection = /^(archive|completed|done)$/i.test(h[2]);
    const m = !inFence && !skipSection && OPEN_TOP_TASK_RE.exec(l);
    if (!m || EXAMPLE_RE.test(m[1].trim())) { keep.push(l); continue; }
    taken.push(l);
    count++;
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) taken.push(lines[++i]);
  }
  return { remaining: keep.join(eol), tasks: taken, count };
}

/** Adds lines under "## {heading}" (created after the title block if missing). Returns new text. */
function addUnderHeading(noteText, heading, newLines) {
  const eol = noteText.includes('\r\n') ? '\r\n' : '\n';
  const lines = noteText.split(/\r?\n/);
  const sec = sections(noteText).find(s => s.title.toLowerCase() === heading.toLowerCase());
  if (sec) {
    let at = sec.line + 1;
    if (lines[at] !== undefined && lines[at].trim() === '') at++;
    lines.splice(at, 0, ...newLines);
  } else {
    // Right after the "# Title" line (and the blank line after it), before the first section
    let at = lines.findIndex(l => /^#\s/.test(l));
    at = at < 0 ? 0 : at + 1;
    while (at < lines.length && lines[at].trim() === '') at++;
    lines.splice(at, 0, `## ${heading}`, '', ...newLines, '');
  }
  return lines.join(eol);
}

module.exports = { sections, insertTask, takeOpenTasks, addUnderHeading };
