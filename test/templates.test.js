const { test } = require('node:test');
const assert = require('node:assert');
const { formatDate, renderTemplate, relativeTime } = require('../src/templates');

const d = new Date(2026, 9, 3, 9, 5, 7); // 3 Oct 2026, Saturday, 09:05:07

test('formatDate tokens and literals', () => {
  assert.strictEqual(formatDate(d, 'YYYY-MM-DD'), '2026-10-03');
  assert.strictEqual(formatDate(d, 'dddd, DD MMMM YYYY HH:mm:ss'), 'Saturday, 03 October 2026 09:05:07');
  assert.strictEqual(formatDate(d, 'ddd DD MMM'), 'Sat 03 Oct');
  assert.strictEqual(formatDate(d, '[Week of] YYYY/MM'), 'Week of 2026/10');
});

test('renderTemplate fills placeholders and finds the cursor', () => {
  const r = renderTemplate('# {{title}}\n{{date}} {{time}}\n\n{{cursor}}\n{{unknown}}', { title: 'Standup', now: d });
  assert.strictEqual(r.text, '# Standup\n2026-10-03 09:05\n\n\n{{unknown}}');
  assert.deepStrictEqual(r.cursor, { line: 3, col: 0 });
  assert.strictEqual(renderTemplate('- {{text}} ({{date:DD/MM}})', { text: 'call', now: d }).text, '- call (03/10)');
  assert.strictEqual(renderTemplate('{{datetime}}', { now: d, dateFormat: 'DD.MM.YYYY' }).text, '03.10.2026 09:05');
  assert.strictEqual(renderTemplate('no placeholders').cursor, null);
});

test('relativeTime', () => {
  const now = d.getTime();
  assert.strictEqual(relativeTime(now - 10e3, now), 'just now');
  assert.strictEqual(relativeTime(now - 5 * 60e3, now), '5m ago');
  assert.strictEqual(relativeTime(now - 3 * 3600e3, now), '3h ago');
  assert.strictEqual(relativeTime(now - 2 * 86400e3, now), '2d ago');
  assert.strictEqual(relativeTime(now - 30 * 86400e3, now), '2026-09-03');
});
