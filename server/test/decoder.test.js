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

test('legacy native addon API remains supported during rolling deployments', () => {
  const txid = 'ab'.repeat(32);
  let call;
  const legacyAddon = {
    getTransactionData(hex, height) {
      call = { hex, height };
      return JSON.stringify({
        txid: `"${txid}"`,
        n_transparent_vin: 1,
        n_transparent_vout: 1,
        n_sapling_spend: null,
        n_sapling_output: null,
        n_orchard_action: null,
        n_ironwood_action: null,
        n_expiry_height: 1234,
      });
    },
  };

  const decoded = decoder.decodeWith(legacyAddon, Buffer.from('cafe', 'hex'), 1200);
  assert.deepEqual(call, { hex: 'cafe', height: '1200' });
  assert.equal(decoded.txid, txid);
  assert.equal(decoded.type, 't2t');
  assert.equal(decoded.expiry, 1234);
  assert.equal(decoded.counts.txid, txid);
});

test('unsupported native addon API fails readiness clearly', () => {
  assert.equal(decoder.mode({ hello() {} }), null);
  assert.throws(
    () => decoder.decodeWith({ hello() {} }, Buffer.alloc(0), 0),
    /supported decoding function/,
  );
});
