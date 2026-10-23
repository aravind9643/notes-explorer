const { test } = require('node:test');
const assert = require('node:assert');
const { parseDue } = require('../src/dateParse');
const { insertTask, takeOpenTasks, addUnderHeading, sections } = require('../src/taskOps');
const { parseNote } = require('../src/noteIndex');

const FRI = new Date(2026, 9, 23); // Friday 23 Oct 2026

test('parseDue understands common phrases and strips them', () => {
  const p = (s) => parseDue(s, FRI);
  assert.deepStrictEqual(p('call the bank tomorrow'), { text: 'call the bank', due: '2026-10-24' });
  assert.deepStrictEqual(p('send report by friday'), { text: 'send report', due: '2026-10-30' }, 'friday on a Friday = next week');
  assert.deepStrictEqual(p('dentist on monday'), { text: 'dentist', due: '2026-10-26' });
  assert.deepStrictEqual(p('plan Q1 next week'), { text: 'plan Q1', due: '2026-10-26' });
  assert.deepStrictEqual(p('renew passport in 3 weeks'), { text: 'renew passport', due: '2026-11-13' });
  assert.deepStrictEqual(p('invoice end of month'), { text: 'invoice', due: '2026-10-31' });
  assert.deepStrictEqual(p('party on 30 oct'), { text: 'party', due: '2026-10-30' });
  assert.deepStrictEqual(p('taxes due jan 15'), { text: 'taxes', due: '2027-01-15' }, 'past dates roll to next year');
  assert.deepStrictEqual(p('book flights 5/11'), { text: 'book flights', due: '2026-11-05' }, 'day first');
  assert.deepStrictEqual(p('ship it 2026-12-01'), { text: 'ship it', due: '2026-12-01' });
  assert.deepStrictEqual(p('clean garage this weekend'), { text: 'clean garage', due: '2026-10-24' });
  assert.deepStrictEqual(p('reply today, please'), { text: 'reply, please', due: '2026-10-23' });
});

test('parseDue leaves ordinary words and existing @due alone', () => {
  assert.deepStrictEqual(parseDue('read Monday.com docs', FRI), { text: 'read Monday.com docs', due: null });
  assert.deepStrictEqual(parseDue('update the todays-report file', FRI), { text: 'update the todays-report file', due: null });
  assert.deepStrictEqual(parseDue('fix bug @due(2026-11-01) tomorrow', FRI), { text: 'fix bug @due(2026-11-01) tomorrow', due: null });
  assert.deepStrictEqual(parseDue('meet on 31/02', FRI), { text: 'meet on 31/02', due: null }, 'impossible dates ignored');
  assert.strictEqual(parseDue("review monday's notes by friday", FRI).due, '2026-10-30', 'the last date phrase wins');
});

test('insertTask goes to the named section, else the first section with tasks, else the end', () => {
  const note = '# Tasks\n\n## Today\n\n- [ ] a\n  - [ ] sub\n\n## Later\n\n- [ ] b\n\n## Empty\n\n## Done\n\n- [x] c\n';
  assert.strictEqual(insertTask(note, '- [ ] new').text, '# Tasks\n\n## Today\n\n- [ ] a\n  - [ ] sub\n- [ ] new\n\n## Later\n\n- [ ] b\n\n## Empty\n\n## Done\n\n- [x] c\n');
  assert.match(insertTask(note, '- [ ] new', 'later').text, /## Later\n\n- \[ \] b\n- \[ \] new\n/);
  assert.match(insertTask(note, '- [ ] new', 'Empty').text, /## Empty\n\n- \[ \] new\n\n## Done/);
  assert.strictEqual(insertTask('# Inbox\n\nsome text\n', '- [ ] new').text, '# Inbox\n\nsome text\n\n- [ ] new\n');
  assert.strictEqual(insertTask('# Inbox\n\n- [ ] x\n', '- [ ] new').text, '# Inbox\n\n- [ ] x\n- [ ] new\n');
  assert.deepStrictEqual(sections(note).map(s => s.title), ['Today', 'Later', 'Empty', 'Done']);
});

test('takeOpenTasks moves unfinished top-level tasks with sub-lines, skips examples and done sections', () => {
  const note = '# Thu\n\n## Top 3\n\n- [ ] carry me\n  detail\n- [x] finished\n- [ ] _e.g. example_\n\n## Notes\n\n- [ ] also me\n\n## Done\n\n- [ ] parked here\n';
  const r = takeOpenTasks(note);
  assert.strictEqual(r.count, 2);
  assert.deepStrictEqual(r.tasks, ['- [ ] carry me', '  detail', '- [ ] also me']);
  assert.strictEqual(r.remaining, '# Thu\n\n## Top 3\n\n- [x] finished\n- [ ] _e.g. example_\n\n## Notes\n\n\n## Done\n\n- [ ] parked here\n');
});

test('addUnderHeading adds to an existing section or creates one after the title', () => {
  const today = '# Friday\n\n## Top 3 today\n\n- [ ] x\n';
  assert.strictEqual(addUnderHeading(today, 'Carried over', ['- [ ] a']), '# Friday\n\n## Carried over\n\n- [ ] a\n\n## Top 3 today\n\n- [ ] x\n');
  assert.strictEqual(addUnderHeading('# F\n\n## Carried over\n\n- [ ] old\n', 'carried over', ['- [ ] a']), '# F\n\n## Carried over\n\n- [ ] a\n- [ ] old\n');
});

test('tasks remember their section heading', () => {
  const n = parseNote('# T\n\n- [ ] top\n\n## Today\n\n- [ ] a\n\n### Sub\n\n- [ ] b\n');
  assert.deepStrictEqual(n.tasks.map(t => [t.text, t.section]), [['top', null], ['a', 'Today'], ['b', 'Sub']]);
});
