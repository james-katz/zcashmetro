/**
 * Native decoder regression tests against real mainnet transactions.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const decoder = require('../lib/decoder');
const fixtures = require('./fixtures/txs.json');

test('native decoder loads', () => {
  assert.ok(decoder.isLoaded(), String(decoder.loadError()));
});

test('fixtures decode to the expected counts and type', () => {
  for (const f of fixtures) {
    const d = decoder.decode(f.hex, 0);
    assert.equal(d.txid, f.txid);
    const exp = { ...f.expected, txid: f.expected.txid.replaceAll('"', '') };
    assert.deepEqual(d.counts, exp);
    assert.equal(d.type, decoder.classifyTxType(exp));
    // Height hint must not change the result
    assert.deepEqual(decoder.decode(Buffer.from(f.hex, 'hex'), 3_600_000).counts, exp);
  }
});

test('garbage throws a JS error instead of crashing', () => {
  assert.throws(() => decoder.decode('', 0));
  assert.throws(() => decoder.decode('deadbeef', 0));
  assert.throws(() => decoder.decode(Buffer.alloc(5000, 0xff), 0));
  assert.throws(() => decoder.decode(Buffer.from('050000800a27a726b4d0d6c2', 'hex'), 0));
});
