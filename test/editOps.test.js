const { test } = require('node:test');
const assert = require('node:assert');
const { renameLinks, renameTag, toggleTaskLine, archiveCompleted, parseBoard, moveCard, monthGrid } = require('../src/editOps');

test('renameLinks keeps aliases and anchors, ignores code fences, is case-insensitive', () => {
  const src = 'See [[Old Name]] and [[old name|alias]] and [[Old Name#Intro]] and [[Old Name.md]]\n```\n[[Old Name]]\n```\n[[Other]]';
  const r = renameLinks(src, 'Old Name', 'New');
  assert.strictEqual(r.count, 4);
  assert.strictEqual(r.text, 'See [[New]] and [[New|alias]] and [[New#Intro]] and [[New]]\n```\n[[Old Name]]\n```\n[[Other]]');
  assert.strictEqual(renameLinks('[[Old Namesake]]', 'Old Name', 'X').count, 0);
});

test('renameLinks keeps CRLF line endings', () => {
  assert.strictEqual(renameLinks('a [[x]]\r\nb [[x]]\r\n', 'x', 'y').text, 'a [[y]]\r\nb [[y]]\r\n');
});

test('renameTag renames whole tags and nested tags only', () => {
  const r = renameTag('#work and #work/pos, #workshop\n# work heading\n(#work-anchor) url.com/#work\n```\n#work\n```', 'work', 'job');
  assert.strictEqual(r.text, '#job and #job/pos, #workshop\n# work heading\n(#work-anchor) url.com/#work\n```\n#work\n```');
  assert.strictEqual(r.count, 2);
});

test('toggleTaskLine stamps and unstamps completion dates', () => {
  assert.strictEqual(toggleTaskLine('- [ ] Pay rent', '2026-10-23'), '- [x] Pay rent ✓ 2026-10-23');
  assert.strictEqual(toggleTaskLine('- [x] Pay rent ✓ 2026-10-23'), '- [ ] Pay rent');
  assert.strictEqual(toggleTaskLine('  * [ ] nested'), '  * [x] nested');
  assert.strictEqual(toggleTaskLine('not a task'), null);
});

test('archiveCompleted moves done top-level tasks with their sub-lines under ## Completed / ### date', () => {
  const src = '# P\n\n- [ ] keep\n- [x] done one\n  detail line\n- [ ] keep two\n    - [x] nested stays\n- [X] done two\n';
  const r = archiveCompleted(src, { date: '2026-10-23' });
  assert.strictEqual(r.moved, 2);
  assert.strictEqual(r.text, '# P\n\n- [ ] keep\n- [ ] keep two\n    - [x] nested stays\n\n## Completed\n\n### 2026-10-23\n- [x] done one\n  detail line\n- [X] done two\n');
  // second run on same day appends under the existing date heading; already archived tasks don't move again
  const again = archiveCompleted(r.text.replace('- [ ] keep\n', '- [x] keep\n'), { date: '2026-10-23' });
  assert.strictEqual(again.moved, 1);
  assert.match(again.text, /### 2026-10-23\n- \[x\] done one\n {2}detail line\n- \[X\] done two\n- \[x\] keep\n/);
  assert.strictEqual(archiveCompleted('- [ ] nothing', { date: 'd' }).moved, 0);
});

test('parseBoard and moveCard', () => {
  const src = '# Board\n\n## To do\n\n- [ ] a\n- [ ] b\n  note\n\n## Doing\n\n## Done\n\n- [x] c\n';
  const cols = parseBoard(src);
  assert.deepStrictEqual(cols.map(c => [c.title, c.cards.map(x => x.text)]), [['To do', ['a', 'b']], ['Doing', []], ['Done', ['c']]]);
  const moved = moveCard(src, 5, 1); // "b" (with its note) → Doing
  assert.strictEqual(moved, '# Board\n\n## To do\n\n- [ ] a\n\n## Doing\n\n- [ ] b\n  note\n## Done\n\n- [x] c\n');
  const done = moveCard(src, 4, 2, { doneColumn: 'Done' });
  assert.match(done, /## Done\n\n- \[x\] c\n- \[x\] a\n/);
  assert.throws(() => moveCard(src, 99, 0));
});

test('monthGrid lays out weeks starting Monday', () => {
  const weeks = monthGrid(2026, 9, 1); // October 2026 starts on a Thursday
  assert.strictEqual(weeks[0].findIndex(Boolean), 3);
  assert.strictEqual(weeks.flat().filter(Boolean).length, 31);
  assert.ok(weeks.every(w => w.length === 7));
});
