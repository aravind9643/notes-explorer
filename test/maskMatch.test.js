const { test } = require('node:test');
const assert = require('node:assert');
const { compile, findMasked } = require('../src/maskMatch');

test('masks capture group 1, or the whole match without a group', () => {
  const re = compile([String.raw`(?:password|pwd)\s*[:=]\s*(\S+)`, 'sk-[A-Za-z0-9]{8,}']);
  const r = findMasked('user: bob password: Hunter2! key sk-abcdefgh12', re);
  assert.deepStrictEqual(r.map(x => x.value), ['Hunter2!', 'sk-abcdefgh12']);
  assert.strictEqual('user: bob password: Hunter2!'.slice(r[0].start, r[0].end), 'Hunter2!');
});

test('invalid patterns are skipped, empty list masks nothing', () => {
  assert.strictEqual(compile(['(', 'ok']).length, 1);
  assert.deepStrictEqual(findMasked('password: x', compile([])), []);
});

test('repeated calls give the same result (global regex state is reset)', () => {
  const re = compile([String.raw`secret=(\w+)`]);
  assert.strictEqual(findMasked('secret=a secret=b', re).length, 2);
  assert.strictEqual(findMasked('secret=a secret=b', re).length, 2);
});
