const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseNote, NoteIndex } = require('../src/noteIndex');

test('parses open and done tasks with due dates', () => {
  const n = parseNote('# T\n- [ ] Pay invoice @due(2026-11-01)\n- [x] Done thing\n* [ ] Star bullet');
  assert.deepStrictEqual(n.tasks.map(t => [t.line, t.done, t.text, t.due]), [
    [1, false, 'Pay invoice', '2026-11-01'],
    [2, true, 'Done thing', null],
    [3, false, 'Star bullet', null],
  ]);
});

test('extracts tags but not headings, URL anchors or code blocks', () => {
  const n = parseNote('# Heading\nWork on #payments and #POS-ui\nSee [GOR](#gor-dev) and https://x.io/#frag\n```\n#notatag\n```');
  assert.deepStrictEqual(n.tags.sort(), ['payments', 'pos-ui']);
});

test('extracts wiki links with aliases and anchors', () => {
  const n = parseNote('See [[POS Tasks]] and [[Credentials|creds]] and [[Stock-Selection#Standard]]');
  assert.deepStrictEqual(n.links.map(l => l.target), ['POS Tasks', 'Credentials', 'Stock-Selection']);
});

test('tasks inside fenced code are ignored', () => {
  assert.strictEqual(parseNote('```\n- [ ] not a task\n```\n- [ ] real').tasks.length, 1);
});

test('index scans, caches by mtime, searches, resolves links and backlinks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  fs.mkdirSync(path.join(dir, 'Work'));
  fs.mkdirSync(path.join(dir, '_archive'));
  fs.writeFileSync(path.join(dir, 'Work', 'POS Tasks.md'), '- [ ] Split checks #pos\n- [x] Login');
  fs.writeFileSync(path.join(dir, 'Daily.md'), 'Follow up on [[POS Tasks]] #pos #daily');
  fs.writeFileSync(path.join(dir, '_archive', 'old.md'), '- [ ] hidden');
  const idx = new NoteIndex();
  await idx.scan(dir, new Set(['_archive']));

  assert.strictEqual(idx.cache.size, 2);
  assert.deepStrictEqual(idx.openTasks().map(t => t.text), ['Split checks #pos']);
  assert.strictEqual(idx.search('split').length, 1);
  assert.deepStrictEqual(idx.allTags(), [['pos', 2], ['daily', 1]]);
  assert.strictEqual(idx.filesWithTag('daily').length, 1);
  const pos = idx.resolveLink('pos tasks');
  assert.ok(pos && pos.endsWith('POS Tasks.md'));
  assert.strictEqual(idx.backlinks(pos).length, 1);

  // deleting a file drops it from the cache on next scan
  fs.unlinkSync(path.join(dir, 'Daily.md'));
  await idx.scan(dir, new Set(['_archive']));
  assert.strictEqual(idx.cache.size, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('search options: match case, whole word, regex, folder and tag scope', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  fs.mkdirSync(path.join(dir, 'Work'));
  fs.writeFileSync(path.join(dir, 'Work', 'a.md'), 'Cart total\ncartridge #shop');
  fs.writeFileSync(path.join(dir, 'b.md'), 'cart again\nInvoice 2026-10');
  const idx = new NoteIndex();
  await idx.scan(dir, new Set());

  assert.strictEqual(idx.search('cart').length, 3);
  assert.strictEqual(idx.search('cart', { matchCase: true }).length, 2);
  assert.strictEqual(idx.search('cart', { wholeWord: true }).length, 2);
  assert.strictEqual(idx.search(String.raw`\d{4}-\d{2}`,{ regex: true }).length, 1);
  assert.strictEqual(idx.search('a+b(', {}).length, 0); // special characters are literal without regex
  assert.throws(() => idx.search('a(', { regex: true }));
  assert.strictEqual(idx.search('cart', { folder: path.join(dir, 'Work') }).length, 2);
  assert.strictEqual(idx.search('cart', { tag: 'shop' }).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('task tags, completion dates, link positions, graph and unresolved links', async () => {
  const n = parseNote('- [x] Ship #release ✓ 2026-10-20\n- [ ] Plan #release #q4 @due(2026-11-01)\nSee [[B]] and [[Nope]]');
  assert.deepStrictEqual(n.tasks.map(t => [t.text, t.doneOn, t.tags]), [
    ['Ship #release', '2026-10-20', ['release']],
    ['Plan #release #q4', null, ['release', 'q4']]
  ]);
  assert.deepStrictEqual(n.links.map(l => [l.target, l.line, l.col, l.length]), [['B', 2, 4, 5], ['Nope', 2, 14, 8]]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  fs.writeFileSync(path.join(dir, 'A.md'), 'See [[B]] and [[Nope]] and [[B]]');
  fs.writeFileSync(path.join(dir, 'B.md'), 'Back to [[A]]');
  fs.writeFileSync(path.join(dir, 'C.md'), 'alone');
  const idx = new NoteIndex();
  await idx.scan(dir, new Set());
  const g = idx.graph();
  assert.strictEqual(g.nodes.length, 4); // A, B, C, missing:nope
  assert.strictEqual(g.edges.length, 3); // A→B (deduped), A→missing, B→A
  assert.ok(g.nodes.find(x => x.missing && x.name === 'Nope'));
  assert.deepStrictEqual(idx.unresolvedLinks(path.join(dir, 'A.md')).map(l => l.target), ['Nope']);
  assert.strictEqual(idx.allTasks().length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scanning 3000 notes stays fast, and a rescan with no changes is cheaper', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  for (let d = 0; d < 30; d++) {
    fs.mkdirSync(path.join(dir, `f${d}`));
    for (let i = 0; i < 100; i++)
      fs.writeFileSync(path.join(dir, `f${d}`, `n${i}.md`), `# Note ${i}\n- [ ] task ${i} #t${i % 7}\nSee [[n${(i + 1) % 100}]]\n${'lorem ipsum '.repeat(40)}\n`);
  }
  const idx = new NoteIndex();
  let t0 = Date.now();
  await idx.scan(dir, new Set());
  const first = Date.now() - t0;
  t0 = Date.now();
  await idx.scan(dir, new Set());
  const second = Date.now() - t0;
  assert.strictEqual(idx.cache.size, 3000);
  assert.ok(first < 15000, `first scan took ${first}ms`);
  assert.ok(second <= first, `rescan ${second}ms should not exceed first scan ${first}ms`);
  t0 = Date.now();
  idx.search('ipsum');
  assert.ok(Date.now() - t0 < 3000, 'search over 3000 notes');
  console.log(`  3000 notes: first scan ${first}ms, rescan ${second}ms`);
  fs.rmSync(dir, { recursive: true, force: true });
});
