/**
 * Safe wrapper around the native (Rust) decoder + transaction classification.
 */
const path = require('path');

let native = null;
let loadError = null;
try {
  native = require(path.join(__dirname, '..', 'index.node'));
} catch (e) {
  loadError = e;
}

/**
 * Classify a transaction by its input/output pool types.
 * (Rules unchanged from the original implementation.)
 * @param {{ n_transparent_vin: number, n_transparent_vout: number, n_sapling_spend: number, n_sapling_output: number, n_orchard_action: number, n_ironwood_action: number }} tx
 * @returns {string} Classification like "t2t", "t2z", "z2z", "o2o", etc.
 */
function classifyTxType(tx) {
  if (tx.n_transparent_vin > 0) {
    if (tx.n_transparent_vout > 0) return 't2t';
    if (tx.n_sapling_output > 0) return 't2z';
    if (tx.n_orchard_action > 0) return 't2o';
    if (tx.n_ironwood_action > 0) return 't2i';
  } else if (tx.n_sapling_spend > 0) {
    if (tx.n_transparent_vout > 0) return 'z2t';
    if (tx.n_sapling_output > 0) return 'z2z';
    if (tx.n_orchard_action > 0) return 'z2o';
    if (tx.n_ironwood_action > 0) return 'z2i';
  } else if (tx.n_orchard_action > 0) {
    if (tx.n_transparent_vout > 0) return 'o2t';
    if (tx.n_sapling_output > 0) return 'o2z';
    if (tx.n_ironwood_action > 0) return 'o2i';
    return 'o2o';
  } else if (tx.n_ironwood_action > 0) {
    if (tx.n_transparent_vout > 0) return 'i2t';
    if (tx.n_sapling_output > 0) return 'i2z';
    if (tx.n_orchard_action > 0) return 'i2o';
    return 'i2i';
  }
  return 'unknown';
}

/**
 * Decode raw transaction bytes.
 * @param {Buffer|Uint8Array|string} data  Raw bytes (or hex string)
 * @param {number} [heightHint]  Height used to pick the consensus branch (0 = unknown)
 * @returns {{ txid: string, type: string, expiry: number, counts: object }}
 * @throws if the addon is missing or the transaction can't be decoded
 */
function decode(data, heightHint = 0) {
  if (!native) throw new Error(`native decoder not loaded: ${loadError && loadError.message}`);
  const buf = typeof data === 'string' ? Buffer.from(data, 'hex') : Buffer.from(data);
  const h = Number(heightHint);
  const j = native.decodeTransaction(buf, Number.isFinite(h) && h > 0 && h < 2 ** 32 ? h : 0);
  if (!j || typeof j.txid !== 'string' || !/^[0-9a-f]{64}$/.test(j.txid)) {
    throw new Error('decoder returned an invalid txid');
  }
  return {
    txid: j.txid,
    type: classifyTxType(j),
    expiry: Number(j.n_expiry_height) || 0,
    counts: j,
  };
}

module.exports = {
  decode,
  classifyTxType,
  isLoaded: () => native !== null,
  loadError: () => loadError,
  hello: () => (native ? native.hello() : null),
};
