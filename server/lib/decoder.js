/**
 * Safe wrapper around the native (Rust) decoder + transaction classification.
 */
const path = require('path');

let native = null;
let nativeLoadError = null;
try {
  native = require(path.join(__dirname, '..', 'index.node'));
} catch (e) {
  nativeLoadError = e;
}

function mode(addon = native) {
  if (addon && typeof addon.decodeTransaction === 'function') return 'buffer-object';
  if (addon && typeof addon.getTransactionData === 'function') return 'legacy-json';
  return null;
}

function loadError() {
  if (nativeLoadError) return nativeLoadError;
  if (!mode()) return new Error('native addon exports neither decodeTransaction nor getTransactionData');
  return null;
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
function decodeWith(addon, data, heightHint = 0) {
  const addonMode = mode(addon);
  if (!addonMode) throw new Error('native decoder does not expose a supported decoding function');

  const buf = typeof data === 'string' ? Buffer.from(data, 'hex') : Buffer.from(data);
  const h = Number(heightHint);
  const safeHeight = Number.isFinite(h) && h > 0 && h < 2 ** 32 ? Math.floor(h) : 0;

  let j;
  if (addonMode === 'buffer-object') {
    j = addon.decodeTransaction(buf, safeHeight);
  } else {
    const json = addon.getTransactionData(buf.toString('hex'), String(safeHeight));
    j = typeof json === 'string' ? JSON.parse(json) : json;
  }

  // Older addons serialized the txid as a quoted string inside JSON.
  const txid = typeof j?.txid === 'string' ? j.txid.replaceAll('"', '').toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    throw new Error('decoder returned an invalid txid');
  }
  const counts = { ...j, txid };
  return {
    txid,
    type: classifyTxType(counts),
    expiry: Number(counts.n_expiry_height) || 0,
    counts,
  };
}

function decode(data, heightHint = 0) {
  if (!native) throw new Error(`native decoder not loaded: ${nativeLoadError && nativeLoadError.message}`);
  return decodeWith(native, data, heightHint);
}

module.exports = {
  decode,
  decodeWith,
  classifyTxType,
  isLoaded: () => mode() !== null,
  loadError,
  mode,
  hello: () => (native && typeof native.hello === 'function' ? native.hello() : 'loaded'),
};
