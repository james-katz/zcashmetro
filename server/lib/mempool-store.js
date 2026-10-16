/**
 * In-memory mempool store. Single source of truth for the HTTP layer.
 *
 * - `txs`:   txid -> { txid, type, expiry, firstSeen, lastCheckedAt }
 * - `mined`: txid -> height  (recently mined txs, used for the train animation
 *                              and to stop mined txs from being re-added)
 *
 * Every mutation bumps `version`, which lets the HTTP layer cache serialized
 * responses cheaply.
 */
class MempoolStore {
  constructor() {
    this.clear();
  }

  clear() {
    /** @type {Map<string, {txid: string, type: string, expiry: number, firstSeen: number, lastCheckedAt: number}>} */
    this.txs = new Map();
    /** @type {Map<string, number>} */
    this.mined = new Map();
    this.version = (this.version || 0) + 1;
    this._listCache = null;
  }

  get size() {
    return this.txs.size;
  }

  has(txid) {
    return this.txs.has(txid);
  }

  get(txid) {
    return this.txs.get(txid);
  }

  isMined(txid) {
    return this.mined.has(txid);
  }

  minedHeight(txid) {
    return this.mined.get(txid);
  }

  ids() {
    return [...this.txs.keys()];
  }

  entries() {
    return [...this.txs.values()];
  }

  /**
   * @param {{ txid: string, type: string, expiry: number }} tx
   * @returns {boolean} true if it was added
   */
  add(tx) {
    if (this.txs.has(tx.txid) || this.mined.has(tx.txid)) return false;
    const now = Date.now();
    this.txs.set(tx.txid, {
      txid: tx.txid,
      type: tx.type,
      expiry: tx.expiry || 0,
      firstSeen: now,
      lastCheckedAt: 0,
    });
    this._touch();
    return true;
  }

  remove(txid) {
    if (this.txs.delete(txid)) {
      this._touch();
      return true;
    }
    return false;
  }

  markMined(txid, height) {
    this.txs.delete(txid);
    this.mined.set(txid, height);
    this._touch();
  }

  /**
   * Forget mined txids older than `keepBlocks` below the tip.
   * @param {number} tipHeight
   * @param {number} keepBlocks
   */
  pruneMined(tipHeight, keepBlocks) {
    let changed = false;
    for (const [txid, h] of this.mined) {
      if (h <= tipHeight - keepBlocks) {
        this.mined.delete(txid);
        changed = true;
      }
    }
    if (changed) this._touch();
  }

  /** @returns {{ txid: string, type: string }[]} in arrival order */
  list() {
    if (!this._listCache) {
      this._listCache = [];
      for (const t of this.txs.values()) this._listCache.push({ txid: t.txid, type: t.type });
    }
    return this._listCache;
  }

  /** @returns {{ txid: string, height: number }[]} */
  minedList() {
    const out = [];
    for (const [txid, height] of this.mined) out.push({ txid, height });
    return out;
  }

  _touch() {
    this.version++;
    this._listCache = null;
  }
}

module.exports = MempoolStore;
