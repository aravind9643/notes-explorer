const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { compileExcludes } = require('../src/globMatch');
const { sanitizeHtml } = require('../src/sanitize');
const { encrypt, decrypt, isSecureNote } = require('../src/secureNote');
const { nextDate, rollRecurring, iso } = require('../src/recurrence');
const { parseNote } = require('../src/noteIndex');

test('exclude patterns: names, folders, anchored paths, ** and negation', () => {
  const ex = compileExcludes(['# comment', '', '*.log', 'build/', '/drafts', 'docs/**/tmp', '!keep.log']);
  const p = (...s) => path.join(...s);
  assert.ok(ex('error.log'));
  assert.ok(ex(p('a', 'b', 'x.log')));
  assert.ok(!ex('keep.log'), 'negated');
  assert.ok(ex('build', true));
  assert.ok(ex(p('sub', 'build', 'out.md')), 'files inside a build/ folder');
  assert.ok(!ex('build'), 'a file named build is not a folder');
  assert.ok(ex('drafts', true));
  assert.ok(!ex(p('notes', 'drafts'), true), 'anchored to root');
  assert.ok(ex(p('docs', 'a', 'b', 'tmp'), true));
  assert.ok(!ex('readme.md'));
});

test('sanitizeHtml removes scripts, handlers and script URLs but keeps content', () => {
  const dirty = '<h1 onclick="evil()">Title</h1><script>alert(1)</script><p>ok <a href="javascript:alert(1)">x</a> <a href="https://a.b">y</a></p>' +
    '<img src=x onerror=alert(1)><iframe src="https://e"></iframe><SCRIPT src="a.js"></SCRIPT><a href=\'vbscript:x\'>v</a><svg><a xlink:href="javascript:1">s</a></svg>';
  const clean = sanitizeHtml(dirty);
  assert.doesNotMatch(clean, /script|onclick|onerror|javascript:|vbscript:|iframe/i);
  assert.match(clean, /<h1>Title<\/h1>/);
  assert.match(clean, /href="https:\/\/a\.b"/);
  assert.match(clean, /<img src=x>/);
});

test('encrypted notes round-trip; wrong password and tampering are rejected', () => {
  const file = encrypt('# Secret\n\npin: 1234\n', 'correct horse');
  assert.ok(isSecureNote(file));
  assert.doesNotMatch(file, /Secret|1234/);
  assert.strictEqual(decrypt(file, 'correct horse'), '# Secret\n\npin: 1234\n');
  assert.throws(() => decrypt(file, 'wrong'), (e) => e.code === 'WRONG_PASSWORD');
  const env = JSON.parse(file);
  env.data = Buffer.from('tampered').toString('base64');
  assert.throws(() => decrypt(JSON.stringify(env), 'correct horse'), (e) => e.code === 'WRONG_PASSWORD');
  assert.throws(() => decrypt('# plain note', 'x'), (e) => e.code === 'NOT_SECURE');
  assert.notStrictEqual(encrypt('same', 'pw'), encrypt('same', 'pw'), 'random salt and IV each time');
  assert.throws(() => encrypt('x', ''));
});

test('nextDate rules', () => {
  const d = (s) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };
  assert.strictEqual(iso(nextDate('day', d('2026-10-23'))), '2026-10-24');
  assert.strictEqual(iso(nextDate('3 days', d('2026-10-30'))), '2026-11-02');
  assert.strictEqual(iso(nextDate('week', d('2026-10-23'))), '2026-10-30');
  assert.strictEqual(iso(nextDate('2 weeks', d('2026-10-23'))), '2026-11-06');
  assert.strictEqual(iso(nextDate('month', d('2026-01-31'))), '2026-02-28');
  assert.strictEqual(iso(nextDate('year', d('2028-02-29'))), '2029-02-28');
  assert.strictEqual(iso(nextDate('weekday', d('2026-10-23'))), '2026-10-26'); // Friday → Monday
  assert.strictEqual(iso(nextDate('monday', d('2026-10-23'))), '2026-10-26');
  assert.strictEqual(iso(nextDate('mon,thu', d('2026-10-26'))), '2026-10-29');
  assert.strictEqual(nextDate('fortnightly-ish', d('2026-10-23')), null);
});

test('rollRecurring adds the next occurrence and keeps sub-lines with the done task', () => {
  const src = '- [x] Water plants @every(week) @due(2026-10-23) ✓ 2026-10-23\n  in the kitchen\n- [ ] Other\n- [x] Pay rent @every(month)\n- [x] Done once @due(2026-10-01)\n';
  const r = rollRecurring(src, '2026-10-23');
  assert.strictEqual(r.created, 2);
  assert.strictEqual(r.text,
    '- [x] Water plants @due(2026-10-23) ✓ 2026-10-23\n  in the kitchen\n- [ ] Water plants @every(week) @due(2026-10-30)\n' +
    '- [ ] Other\n- [x] Pay rent\n- [ ] Pay rent @every(month) @due(2026-11-23)\n- [x] Done once @due(2026-10-01)\n');
  assert.strictEqual(rollRecurring(r.text, '2026-10-23').created, 0, 'idempotent');
});

test('headings and [[Note#Heading]] links are parsed', () => {
  const n = parseNote('# Title\n\n## Agenda ##\ntext [[Other#Next steps|see]] and [[Plain]]\n```\n# not a heading\n```');
  assert.deepStrictEqual(n.headings, [{ level: 1, text: 'Title', line: 0 }, { level: 2, text: 'Agenda', line: 2 }]);
  assert.deepStrictEqual(n.links.map(l => [l.target, l.heading]), [['Other', 'Next steps'], ['Plain', null]]);
});
