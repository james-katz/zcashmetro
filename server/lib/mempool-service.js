/**
 * MempoolService — the self-aware engine behind the API.
 *
 * Responsibilities
 * ----------------
 * 1. Tip monitor     Polls GetLatestBlock. On a new block it reconciles the
 *                    mempool FIRST and only then publishes the new tip, so
 *                    clients always see a consistent (height, mempool) pair.
 * 2. Mempool stream  Ingests GetMempoolStream. Each session has an id; events
 *                    from stale sessions are ignored, so there can never be
 *                    two live streams feeding the store.
 * 3. Reconciler      Checks every held tx with GetTransaction (bounded
 *                    concurrency, per-call deadline, overall time budget):
 *                    mined → moved to `mined`, NOT_FOUND → dropped,
 *                    transient error → kept (never drop data on a hiccup).
 * 4. Watchdog        Every few seconds verifies invariants and heals:
 *                      - lightwalletd silent       → recreate client / fail over
 *                      - lightwalletd dead         → soft reset
 *                      - task running too long     → soft reset
 *                      - stream lost / too old     → reopen / rotate
 *                      - stream reconnect storm    → soft reset
 *                      - tip going backwards       → soft reset
 *                      - reconcile keeps failing   → soft reset
 *                      - mempool absurdly large    → soft reset
 *                      - too many resets / memory  → exit (supervisor restarts us)
 *
 * A *soft reset* bumps `gen` (the epoch). Every async operation captures the
 * epoch when it starts and discards its result if the epoch changed, so
 * nothing from the "old world" can leak into the fresh state.
 */
const { EventEmitter } = require('events');
const { monitorEventLoopDelay } = require('perf_hooks');

const defaultGrpc = require('../grpc_connector');
const decoder = require('./decoder');
const MempoolStore = require('./mempool-store');
const createLogger = require('./logger');

/** Parse a lightwalletd height (uint64 as string). 0 = not mined. */
function parseHeight(h) {
  const n = Number(h);
  return Number.isFinite(n) && n > 0 && n < 2 ** 32 ? n : 0;
}

class MempoolService extends EventEmitter {
  /**
   * @param {object} cfg  See lib/config.js
   * @param {{ grpc?: object, decoder?: object, logger?: object, onFatal?: (reason: string) => void }} [deps]
   */
  constructor(cfg, deps = {}) {
    super();
    this.cfg = cfg;
    this.grpc = deps.grpc || defaultGrpc;
    this.decoder = deps.decoder || decoder;
    this.log = deps.logger || createLogger('mempool');
    this.onFatal = deps.onFatal || ((reason) => {
      this.log.error(`FATAL: ${reason} — exiting so the supervisor restarts a fresh process`);
      setTimeout(() => process.exit(1), 100);
    });

    this.store = new MempoolStore();
    this.gen = 0;
    this.serverIdx = 0;
    this.client = null;
    // Changes every time the gRPC channel is replaced. Unlike `gen`, this
    // does not imply a fresh mempool; it only invalidates late RPC results
    // from the previous channel.
    this.clientSeq = 0;
    this.tip = null; // { height, hash, blockTime, at }

    this.stream = null; // { id, gen, emitter, startedAt, startHeight, lastDataAt, count }
    this.streamSeq = 0;
    this.streamRetry = 0;
    this.streamTimer = null;
    this.streamOpens = []; // timestamps, for reconnect-storm detection

    this.tasks = { tip: null, reconcile: null };
    this.reconcileChain = Promise.resolve();
    this.reconcileFailures = 0;
    this.lastReconcile = null;
    this.tipRegressions = 0;
    this.lastTipOkAt = 0;
    this.lastTipError = null;
    this.lastClientRecreateAt = 0;
    this.genStartedAt = Date.now();
    this.startedAt = Date.now();
    this.resets = [];
    this.loopLagStrikes = 0;
    this.lastLoopLagMs = 0;
    this.timers = [];
    this.running = false;
    this.fatalRaised = false;

    this.counters = {
      decoded: 0,
      decodeErrors: 0,
      added: 0,
      mined: 0,
      dropped: 0,
      evicted: 0,
      streamsOpened: 0,
      streamErrors: 0,
      tipErrors: 0,
      clientRecreates: 0,
      softResets: 0,
    };

    this.loopDelay = monitorEventLoopDelay({ resolution: 20 });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start() {
    if (this.running) return;
    this.running = true;
    this.loopDelay.enable();
    this.log.info(`Starting. lightwalletd servers: ${this.cfg.GRPC_SERVERS.join(', ')}`);
    this._createClient();
    this.openStream();
    this.pollTip();

    this.timers.push(setInterval(() => this.pollTip(), this.cfg.TIP_POLL_MS));
    this.timers.push(setInterval(() => this.reconcile('periodic'), this.cfg.RECONCILE_INTERVAL_MS));
    this.timers.push(setInterval(() => this.watchdog(), this.cfg.WATCHDOG_INTERVAL_MS));
  }

  stop() {
    this.running = false;
    this.gen++;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this._closeStream();
    if (this.streamTimer) clearTimeout(this.streamTimer);
    this.streamTimer = null;
    if (this.client) this.grpc.close(this.client);
    this.client = null;
    this.loopDelay.disable();
  }

  get server() {
    return this.cfg.GRPC_SERVERS[this.serverIdx % this.cfg.GRPC_SERVERS.length];
  }

  _createClient() {
    this.client = this.grpc.init(this.server, {
      plaintext: this.cfg.GRPC_PLAINTEXT,
      deadlineMs: this.cfg.RPC_DEADLINE_MS,
    });
    this.clientSeq++;
    this.lastClientRecreateAt = Date.now();
  }

  /**
   * Drop the current gRPC channel (and stream) and open a fresh one,
   * optionally failing over to the next configured server.
   */
  recreateClient(reason, { failover = true } = {}) {
    this.counters.clientRecreates++;
    const old = this.client;
    this._closeStream();
    if (old) this.grpc.close(old);
    if (failover && this.cfg.GRPC_SERVERS.length > 1) this.serverIdx++;
    this.log.warn(`Recreating gRPC client (${reason}) → ${this.server}`);
    this._createClient();
    // In-flight tasks on the old client will fail; let them clear themselves.
    this.tasks.tip = null;
    this.streamRetry = 0;
    this.openStream();
  }

  /**
   * Throw everything away and start from a clean slate, in-process.
   * @param {string} reason
   */
  softReset(reason) {
    if (!this.running) return;
    const now = Date.now();
    this.resets.push({ at: now, reason });
    this.resets = this.resets.filter((r) => now - r.at < this.cfg.RESET_WINDOW_MS);
    this.counters.softResets++;
    this.log.error(`SOFT RESET #${this.counters.softResets}: ${reason}`);

    if (this.resets.length > this.cfg.MAX_RESETS_IN_WINDOW) {
      this._fatal(`${this.resets.length} soft resets within ${Math.round(this.cfg.RESET_WINDOW_MS / 1000)}s`);
      return;
    }

    this.gen++;
    this.genStartedAt = now;
    if (this.streamTimer) clearTimeout(this.streamTimer);
    this.streamTimer = null;
    this.streamOpens = [];
    this.tasks = { tip: null, reconcile: null };
    this.reconcileChain = Promise.resolve();
    this.reconcileFailures = 0;
    this.tipRegressions = 0;
    this.lastTipOkAt = 0;
    this.tip = null;
    this.store.clear();

    this.recreateClient(`reset: ${reason}`);
    this.pollTip();
    this.emit('reset', reason);
  }

  _fatal(reason) {
    if (this.fatalRaised) return;
    this.fatalRaised = true;
    this.stop();
    this.onFatal(reason);
  }

  // -------------------------------------------------------------------------
  // Tip monitor
  // -------------------------------------------------------------------------

  async pollTip() {
    if (!this.running || this.tasks.tip) return;
    const gen = this.gen;
    const clientSeq = this.clientSeq;
    const client = this.client;
    const task = { startedAt: Date.now() };
    this.tasks.tip = task;
    try {
      const b = await this.grpc.getLatestBlock(client);
      if (gen !== this.gen || clientSeq !== this.clientSeq) return;
      const height = parseHeight(b && b.height);
      if (!height) throw new Error(`invalid tip height ${b && b.height}`);
      const hash = b.hash ? Buffer.from(b.hash).reverse().toString('hex') : '';
      this.lastTipOkAt = Date.now();
      this.lastTipError = null;

      if (!this.tip) {
        const blockTime = await this._fetchBlockTime(client, height);
        if (gen !== this.gen || clientSeq !== this.clientSeq) return;
        this._publishTip(height, hash, blockTime);
        this.log.info(`Tip: ${height}`);
        return;
      }

      if (height > this.tip.height || (height === this.tip.height && hash && hash !== this.tip.hash)) {
        this.tipRegressions = 0;
        const blockTime = await this._fetchBlockTime(client, height);
        if (gen !== this.gen || clientSeq !== this.clientSeq) return;
        // Reconcile BEFORE publishing, so (height, mempool) change atomically.
        await this.reconcile('block', height);
        if (gen !== this.gen || clientSeq !== this.clientSeq) return;
        const prev = this.tip.height;
        this._publishTip(height, hash, blockTime);
        this.log.info(
          `New block ${height}${height === prev ? ' (reorg)' : ''} — mempool ${this.store.size}, ` +
            `last reconcile: ${JSON.stringify(this.lastReconcile && this.lastReconcile.result)}`,
        );
      } else if (height < this.tip.height) {
        this.tipRegressions++;
        this.log.warn(`Tip went backwards: ${height} < ${this.tip.height} (${this.tipRegressions}x)`);
        if (this.tipRegressions >= this.cfg.MAX_TIP_REGRESSIONS) {
          this.softReset(`tip went backwards ${this.tipRegressions} polls in a row`);
        }
      } else {
        this.tipRegressions = 0;
      }
    } catch (e) {
      if (gen !== this.gen || clientSeq !== this.clientSeq) return;
      this.counters.tipErrors++;
      const msg = (e && (e.details || e.message)) || String(e);
      if (msg !== this.lastTipError) this.log.warn(`Tip poll failed: ${msg}`);
      this.lastTipError = msg;
    } finally {
      if (this.tasks.tip === task) this.tasks.tip = null;
    }
  }

  _publishTip(height, hash, blockTime) {
    this.tip = { height, hash, blockTime, at: Date.now() };
    this.store.pruneMined(height, this.cfg.MINED_MEMORY_BLOCKS);
    if (this.stream && this.stream.startHeight === null) this.stream.startHeight = height;
    this._checkStreamFreshness();
    this.emit('tip', this.tip);
  }

  async _fetchBlockTime(client, height) {
    try {
      const ts = await this.grpc.getTreeState(client, height);
      const t = Number(ts && ts.time);
      if (t > 0) return t;
    } catch (_) {
      /* fall through */
    }
    try {
      const blk = await this.grpc.getBlock(client, height);
      const t = Number(blk && blk.time);
      if (t > 0) return t;
    } catch (_) {
      /* non-critical */
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Mempool stream
  // -------------------------------------------------------------------------

  openStream() {
    if (!this.running) return;
    if (this.streamTimer) {
      clearTimeout(this.streamTimer);
      this.streamTimer = null;
    }
    this._closeStream();

    const now = Date.now();
    this.streamOpens = this.streamOpens.filter((t) => now - t < 5 * 60 * 1000);
    this.streamOpens.push(now);
    if (this.streamOpens.length > 40) {
      this.softReset(`stream reconnect storm (${this.streamOpens.length} opens in 5 min)`);
      return;
    }

    let emitter;
    try {
      emitter = this.grpc.getMempoolStream(this.client);
    } catch (e) {
      this.log.warn(`Failed to open mempool stream: ${e.message}`);
      this._scheduleStreamReopen(this._streamBackoff());
      return;
    }
    const s = {
      id: ++this.streamSeq,
      gen: this.gen,
      emitter,
      startedAt: now,
      startHeight: this.tip ? this.tip.height : null,
      lastDataAt: null,
      count: 0,
    };
    this.stream = s;
    this.counters.streamsOpened++;
    this.log.debug(`Stream #${s.id} opened`);

    emitter.on('newtx', (tx) => {
      if (this.stream !== s) return;
      s.lastDataAt = Date.now();
      s.count++;
      this._ingest(tx);
    });

    emitter.on('closed', () => {
      if (this.stream !== s) return;
      this.stream = null;
      const life = Date.now() - s.startedAt;
      this.log.info(`Stream #${s.id} closed after ${Math.round(life / 1000)}s (${s.count} txs)`);
      if (s.count === 0 && life < 2000) {
        // Closing instantly with no data is not normal — back off.
        this._scheduleStreamReopen(this._streamBackoff());
      } else {
        this.streamRetry = 0;
        this._scheduleStreamReopen(1000);
      }
      // A closed stream usually means a new block: check right away.
      this.pollTip();
    });

    emitter.on('error', (e) => {
      if (this.stream !== s) return;
      this.stream = null;
      this.counters.streamErrors++;
      const delay = this._streamBackoff();
      this.log.warn(`Stream #${s.id} error: ${(e && (e.details || e.message)) || e} — retry in ${delay}ms`);
      this._scheduleStreamReopen(delay);
    });
  }

  _streamBackoff() {
    const d = Math.min(30000, 1000 * 2 ** this.streamRetry);
    this.streamRetry = Math.min(this.streamRetry + 1, 10);
    return d;
  }

  _scheduleStreamReopen(delay) {
    if (this.streamTimer || !this.running) return;
    const gen = this.gen;
    this.streamTimer = setTimeout(() => {
      this.streamTimer = null;
      if (gen === this.gen) this.openStream();
    }, delay);
  }

  _closeStream() {
    const s = this.stream;
    this.stream = null;
    if (s) {
      try {
        s.emitter.cancel();
      } catch (_) {
        /* ignore */
      }
    }
  }

  _checkStreamFreshness() {
    const s = this.stream;
    if (!s) return;
    const age = Date.now() - s.startedAt;
    if (age > this.cfg.STREAM_MAX_AGE_MS) {
      this.log.info(`Rotating stream #${s.id} (age ${Math.round(age / 1000)}s)`);
      this.openStream();
    } else if (this.tip && s.startHeight !== null && this.tip.height - s.startHeight >= this.cfg.STREAM_MAX_BLOCKS) {
      this.log.info(`Rotating stream #${s.id} (opened at ${s.startHeight}, tip now ${this.tip.height})`);
      this.openStream();
    }
  }

  _ingest(tx) {
    let d;
    try {
      const hint = parseHeight(tx.height) || (this.tip ? this.tip.height + 1 : 0);
      d = this.decoder.decode(tx.data, hint);
    } catch (e) {
      this.counters.decodeErrors++;
      if (this.counters.decodeErrors <= 20 || this.counters.decodeErrors % 100 === 0) {
        this.log.warn(`Decode failed (${this.counters.decodeErrors} total): ${e.message}`);
      }
      return;
    }
    this.counters.decoded++;
    if (this.store.has(d.txid) || this.store.isMined(d.txid)) return;
    // Original rule: only track transactions with an expiry height.
    if (!(d.expiry > 0)) return;
    // Already past expiry → will never be mined.
    if (this.tip && d.expiry < this.tip.height) return;
    if (this.store.size >= this.cfg.MAX_MEMPOOL_TXS) {
      this.softReset(`mempool exceeded ${this.cfg.MAX_MEMPOOL_TXS} txs`);
      return;
    }
    if (this.store.add({ txid: d.txid, type: d.type, expiry: d.expiry })) {
      this.counters.added++;
      this.log.debug(`Added ${d.txid} (${d.type})`);
    }
  }

  // -------------------------------------------------------------------------
  // Reconciler
  // -------------------------------------------------------------------------

  /**
   * Queue a reconcile. Runs are serialized; returns when this run finished.
   * @param {'block'|'periodic'} reason
   * @param {number} [tipHeight]
   */
  reconcile(reason, tipHeight) {
    if (!this.running) return Promise.resolve();
    if (reason === 'periodic' && this.tasks.reconcile) return Promise.resolve();
    const gen = this.gen;
    const run = this.reconcileChain.then(() => (gen === this.gen ? this._reconcile(reason, tipHeight) : null));
    this.reconcileChain = run.catch(() => {});
    return this.reconcileChain;
  }

  async _reconcile(reason, tipHeight) {
    const gen = this.gen;
    const clientSeq = this.clientSeq;
    const client = this.client;
    const startedAt = Date.now();
    const task = { startedAt, reason };
    this.tasks.reconcile = task;
    const deadline = startedAt + this.cfg.RECONCILE_BUDGET_MS;
    const ids = this.store.ids();
    const res = { reason, total: ids.length, checked: 0, mined: 0, dropped: 0, evicted: 0, errors: 0, aborted: false };
    let i = 0;

    const worker = async () => {
      while (i < ids.length) {
        if (gen !== this.gen || clientSeq !== this.clientSeq || Date.now() > deadline) {
          res.aborted = true;
          return;
        }
        const txid = ids[i++];
        const entry = this.store.get(txid);
        if (!entry) continue;
        if (reason === 'periodic' && Date.now() - entry.firstSeen < 15000) continue;
        try {
          const t = await this.grpc.getTransaction(client, txid, Math.min(5000, this.cfg.RPC_DEADLINE_MS));
          if (gen !== this.gen || clientSeq !== this.clientSeq) {
            res.aborted = true;
            return;
          }
          res.checked++;
          const h = parseHeight(t && t.height);
          if (h > 0) {
            this.store.markMined(txid, h);
            res.mined++;
          } else {
            entry.lastCheckedAt = Date.now();
          }
        } catch (e) {
          if (gen !== this.gen || clientSeq !== this.clientSeq) {
            res.aborted = true;
            return;
          }
          if (this.grpc.isNotFound(e)) {
            this.store.remove(txid);
            res.dropped++;
          } else {
            res.errors++;
          }
        }
      }
    };

    try {
      const n = Math.max(1, Math.min(this.cfg.RECONCILE_CONCURRENCY, ids.length));
      await Promise.all(Array.from({ length: n }, worker));
      if (gen !== this.gen || clientSeq !== this.clientSeq) return;

      // Local evictions (no network): past expiry, or held absurdly long.
      const tip = tipHeight || (this.tip && this.tip.height) || 0;
      const now = Date.now();
      for (const e of this.store.entries()) {
        if ((tip && e.expiry > 0 && tip > e.expiry) || now - e.firstSeen > this.cfg.MAX_TX_AGE_MS) {
          this.store.remove(e.txid);
          res.evicted++;
        }
      }

      this.counters.mined += res.mined;
      this.counters.dropped += res.dropped;
      this.counters.evicted += res.evicted;
      this.lastReconcile = { at: now, durationMs: now - startedAt, result: res };

      const failed = res.aborted || (res.total > 0 && res.checked === 0 && res.errors > 0);
      if (failed) {
        this.reconcileFailures++;
        this.log.warn(`Reconcile (${reason}) failed ${this.reconcileFailures}x: ${JSON.stringify(res)}`);
        if (this.reconcileFailures >= this.cfg.MAX_RECONCILE_FAILURES) {
          this.softReset(`reconcile failed ${this.reconcileFailures} times in a row`);
        }
      } else {
        this.reconcileFailures = 0;
        if (res.mined || res.dropped || res.evicted) {
          this.log.info(`Reconcile (${reason}): ${JSON.stringify(res)} in ${now - startedAt}ms`);
        }
      }
    } finally {
      if (this.tasks.reconcile === task) this.tasks.reconcile = null;
    }
  }

  // -------------------------------------------------------------------------
  // Watchdog
  // -------------------------------------------------------------------------

  watchdog() {
    if (!this.running) return;
    const now = Date.now();
    const cfg = this.cfg;

    // 1. Stuck background tasks
    for (const [name, t] of Object.entries(this.tasks)) {
      if (t && now - t.startedAt > cfg.TASK_STUCK_MS) {
        this.softReset(`task '${name}' stuck for ${Math.round((now - t.startedAt) / 1000)}s`);
        return;
      }
    }

    // 2. lightwalletd responsiveness
    const sinceOk = now - (this.lastTipOkAt || this.genStartedAt);
    if (sinceOk > cfg.GRPC_DEAD_MS) {
      this.softReset(`no successful lightwalletd response for ${Math.round(sinceOk / 1000)}s`);
      return;
    }
    if (sinceOk > cfg.GRPC_STALE_MS && now - this.lastClientRecreateAt > cfg.GRPC_STALE_MS) {
      this.recreateClient(`no successful tip poll for ${Math.round(sinceOk / 1000)}s`);
    }

    // 3. Stream must exist (or be scheduled)
    if (!this.stream && !this.streamTimer) {
      this.log.warn('No mempool stream and none scheduled — reopening');
      this.openStream();
    } else {
      this._checkStreamFreshness();
    }

    // 4. Sanity on data
    if (this.store.size > cfg.MAX_MEMPOOL_TXS) {
      this.softReset(`mempool size ${this.store.size} exceeds ${cfg.MAX_MEMPOOL_TXS}`);
      return;
    }

    // 5. Event loop health (a fully blocked loop is caught by the supervisor)
    const lagMs = Math.round(this.loopDelay.max / 1e6);
    this.lastLoopLagMs = lagMs;
    this.loopDelay.reset();
    if (lagMs > cfg.MAX_LOOP_LAG_MS) {
      this.loopLagStrikes++;
      this.log.warn(`Event loop blocked for ${lagMs}ms (${this.loopLagStrikes}x)`);
      if (this.loopLagStrikes >= 3) {
        this._fatal(`event loop repeatedly blocked (${lagMs}ms)`);
        return;
      }
    } else {
      this.loopLagStrikes = 0;
    }

    // 6. Memory ceiling
    const rssMb = Math.round(process.memoryUsage().rss / 1048576);
    if (rssMb > cfg.MAX_RSS_MB) {
      this._fatal(`RSS ${rssMb}MB exceeds ${cfg.MAX_RSS_MB}MB`);
    }
  }

  // -------------------------------------------------------------------------
  // Queries (used by the HTTP layer)
  // -------------------------------------------------------------------------

  /** @returns {'starting'|'ok'|'degraded'} */
  get status() {
    if (!this.tip) return 'starting';
    const sinceOk = Date.now() - this.lastTipOkAt;
    if (sinceOk > this.cfg.GRPC_STALE_MS) return 'degraded';
    if (!this.stream && this.streamRetry > 2) return 'degraded';
    return 'ok';
  }

  /**
   * Answer "is this tx mined?" cheaply: memory first, then lightwalletd.
   * @param {string} txid
   * @returns {Promise<{ height: number, error?: boolean }>}
   */
  async lookupTx(txid) {
    const minedAt = this.store.minedHeight(txid);
    if (minedAt) return { height: minedAt };
    if (this.store.has(txid)) return { height: -1 };

    const gen = this.gen;
    const clientSeq = this.clientSeq;
    const client = this.client;
    try {
      const t = await this.grpc.getTransaction(client, txid, Math.min(5000, this.cfg.RPC_DEADLINE_MS));
      const h = parseHeight(t && t.height);
      if (h > 0) {
        if (gen === this.gen && clientSeq === this.clientSeq && this.store.has(txid)) {
          this.store.markMined(txid, h);
        }
        return { height: h };
      }
      return { height: -1 };
    } catch (e) {
      if (this.grpc.isNotFound(e) && gen === this.gen && clientSeq === this.clientSeq) {
        this.store.remove(txid);
      }
      return { height: -1, error: true };
    }
  }

  health() {
    const now = Date.now();
    const s = this.stream;
    return {
      status: this.status,
      epoch: this.gen,
      uptimeSec: Math.round((now - this.startedAt) / 1000),
      epochAgeSec: Math.round((now - this.genStartedAt) / 1000),
      lightwalletd: this.server,
      nativeDecoder: this.decoder.isLoaded(),
      tip: this.tip,
      lastTipOkAgoMs: this.lastTipOkAt ? now - this.lastTipOkAt : null,
      lastTipError: this.lastTipError,
      stream: s
        ? { id: s.id, ageSec: Math.round((now - s.startedAt) / 1000), txs: s.count, startHeight: s.startHeight }
        : { id: null, reopenScheduled: !!this.streamTimer, retry: this.streamRetry },
      mempool: this.store.size,
      minedRemembered: this.store.mined.size,
      tasks: Object.fromEntries(
        Object.entries(this.tasks).map(([k, t]) => [k, t ? { runningMs: now - t.startedAt } : null]),
      ),
      lastReconcile: this.lastReconcile,
      reconcileFailures: this.reconcileFailures,
      loopLagMs: this.lastLoopLagMs,
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      counters: this.counters,
      recentResets: this.resets.slice(-10),
    };
  }
}

MempoolService.parseHeight = parseHeight;
module.exports = MempoolService;
