/**
 * Tests for the mempool engine using a fake lightwalletd.
 * Run: npm test (in server/)  — or: node --test test/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const realGrpc = require('../grpc_connector');
const baseCfg = require('../lib/config');
const MempoolService = require('../lib/mempool-service');
const MempoolStore = require('../lib/mempool-store');
const { classifyTxType } = require('../lib/decoder');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txid = (n) => n.toString(16).padStart(64, '0');
const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** Fake lightwalletd */
function fakeGrpc() {
  const f = {
    tip: 100,
    tipHash: null,
    txHeights: new Map(),
    notFound: new Set(),
    transient: new Set(),
    hangTip: false,
    failTip: false,
    hangTx: false,
    streams: [],
    inits: 0,
    closes: 0,
    servers: [],
    init(server) {
      f.inits++;
      f.servers.push(server);
      return { id: f.inits };
    },
    close() {
      f.closes++;
    },
    getLatestBlock() {
      if (f.hangTip) return new Promise(() => {});
      if (f.failTip) return Promise.reject(Object.assign(new Error('unavailable'), { code: 14 }));
      return Promise.resolve({ height: String(f.tip), hash: Buffer.alloc(32, f.tipHash ?? f.tip % 256) });
    },
    getTreeState: async (_c, h) => ({ time: 1_700_000_000 + h }),
    getBlock: async () => {
      throw new Error('unparseable');
    },
    getTransaction(_c, id) {
      if (f.hangTx) return new Promise(() => {});
      if (f.notFound.has(id)) return Promise.reject(Object.assign(new Error('not found'), { code: 5 }));
      if (f.transient.has(id)) return Promise.reject(Object.assign(new Error('deadline'), { code: 4 }));
      return Promise.resolve({ height: String(f.txHeights.get(id) || 0) });
    },
    getMempoolStream() {
      const em = new EventEmitter();
      em.cancel = () => {
        em.cancelled = true;
      };
      f.streams.push(em);
      return em;
    },
    isNotFound: realGrpc.isNotFound,
    /** Push a tx into the latest stream */
    push(id, { type = 'z2z', expiry = 200 } = {}) {
      const s = f.streams[f.streams.length - 1];
      s.emit('newtx', { data: Buffer.from(JSON.stringify({ txid: id, type, expiry })), height: '0' });
    },
  };
  return f;
}

const fakeDecoder = {
  isLoaded: () => true,
  decode(data) {
    const j = JSON.parse(Buffer.from(data).toString());
    if (j.bad) throw new Error('bad tx');
    return { txid: j.txid, type: j.type, expiry: j.expiry, counts: {} };
  },
};

function makeService(overrides = {}, grpc = fakeGrpc()) {
  const cfg = {
    ...baseCfg,
    GRPC_SERVERS: ['a:1', 'b:2'],
    TIP_POLL_MS: 1e9,
    RECONCILE_INTERVAL_MS: 1e9,
    WATCHDOG_INTERVAL_MS: 1e9,
    ...overrides,
  };
  const fatal = [];
  const svc = new MempoolService(cfg, {
    grpc,
    decoder: fakeDecoder,
    logger: silent,
    onFatal: (r) => fatal.push(r),
  });
  return { svc, grpc, cfg, fatal };
}

// ---------------------------------------------------------------------------

test('classifyTxType keeps the original rules', () => {
  const T = (o) => classifyTxType({
    n_transparent_vin: 0, n_transparent_vout: 0, n_sapling_spend: 0, n_sapling_output: 0,
    n_orchard_action: 0, n_ironwood_action: 0, ...o,
  });
  assert.equal(T({ n_transparent_vin: 1, n_transparent_vout: 1 }), 't2t');
  assert.equal(T({ n_transparent_vin: 1, n_sapling_output: 1 }), 't2z');
  assert.equal(T({ n_transparent_vin: 1, n_orchard_action: 1 }), 't2o');
  assert.equal(T({ n_transparent_vin: 1, n_ironwood_action: 1 }), 't2i');
  assert.equal(T({ n_sapling_spend: 1, n_transparent_vout: 1 }), 'z2t');
  assert.equal(T({ n_sapling_spend: 1, n_sapling_output: 1 }), 'z2z');
  assert.equal(T({ n_sapling_spend: 1, n_orchard_action: 1 }), 'z2o');
  assert.equal(T({ n_sapling_spend: 1, n_ironwood_action: 1 }), 'z2i');
  assert.equal(T({ n_orchard_action: 1, n_transparent_vout: 1 }), 'o2t');
  assert.equal(T({ n_orchard_action: 1, n_sapling_output: 1 }), 'o2z');
  assert.equal(T({ n_orchard_action: 1, n_ironwood_action: 1 }), 'o2i');
  assert.equal(T({ n_orchard_action: 1 }), 'o2o');
  assert.equal(T({ n_ironwood_action: 1, n_transparent_vout: 1 }), 'i2t');
  assert.equal(T({ n_ironwood_action: 1, n_sapling_output: 1 }), 'i2z');
  assert.equal(T({ n_ironwood_action: 2 }), 'i2i');
  assert.equal(T({ n_transparent_vin: 1 }), 'unknown');
  assert.equal(T({}), 'unknown');
  // null bundles (absent) behave like 0
  assert.equal(classifyTxType({ n_transparent_vin: null, n_sapling_spend: 1, n_sapling_output: 2 }), 'z2z');
});

test('store: add/markMined/prune and ghost prevention', () => {
  const s = new MempoolStore();
  assert.ok(s.add({ txid: 'a', type: 't2t', expiry: 10 }));
  assert.ok(!s.add({ txid: 'a', type: 't2t', expiry: 10 }));
  s.markMined('a', 50);
  assert.equal(s.size, 0);
  assert.ok(!s.add({ txid: 'a', type: 't2t', expiry: 10 }), 'mined tx must not come back');
  s.pruneMined(80, 20);
  assert.equal(s.mined.size, 0);
});

test('ingest: decodes, dedupes, skips expiry=0 and bad txs', async () => {
  const { svc, grpc } = makeService();
  svc.start();
  await sleep(5);
  grpc.push(txid(1));
  grpc.push(txid(1));
  grpc.push(txid(2), { expiry: 0 }); // original rule: no expiry → ignored
  grpc.streams[0].emit('newtx', { data: Buffer.from(JSON.stringify({ bad: true })), height: '0' });
  assert.deepEqual(svc.store.list(), [{ txid: txid(1), type: 'z2z' }]);
  assert.equal(svc.counters.decodeErrors, 1);
  svc.stop();
});

test('new block: mined txs removed BEFORE the new tip is published', async () => {
  const { svc, grpc } = makeService();
  svc.start();
  await sleep(5);
  assert.equal(svc.tip.height, 100);
  grpc.push(txid(1));
  grpc.push(txid(2));
  grpc.push(txid(3));
  grpc.push(txid(4));
  grpc.txHeights.set(txid(1), 101); // mined
  grpc.notFound.add(txid(2)); // dropped
  grpc.transient.add(txid(3)); // network hiccup → must be kept

  let sawInconsistent = false;
  svc.on('tip', (t) => {
    if (t.height === 101 && svc.store.has(txid(1))) sawInconsistent = true;
  });
  grpc.tip = 101;
  await svc.pollTip();

  assert.equal(svc.tip.height, 101);
  assert.equal(svc.tip.blockTime, 1_700_000_101);
  assert.ok(!sawInconsistent);
  assert.deepEqual(svc.store.list().map((t) => t.txid).sort(), [txid(3), txid(4)]);
  assert.deepEqual(svc.store.minedList(), [{ txid: txid(1), height: 101 }]);
  // mined tx replayed by a new stream session must not reappear
  grpc.push(txid(1));
  assert.ok(!svc.store.has(txid(1)));
  svc.stop();
});

test('lookupTx answers from memory first', async () => {
  const { svc, grpc } = makeService();
  svc.start();
  await sleep(5);
  grpc.push(txid(1));
  assert.deepEqual(await svc.lookupTx(txid(1)), { height: -1 });
  grpc.txHeights.set(txid(9), 55);
  assert.deepEqual(await svc.lookupTx(txid(9)), { height: 55 });
  grpc.notFound.add(txid(8));
  assert.deepEqual(await svc.lookupTx(txid(8)), { height: -1, error: true });
  svc.stop();
});

test('stream: closed/error reopen once; stale sessions are ignored', async () => {
  const { svc, grpc } = makeService();
  svc.start();
  await sleep(5);
  const first = grpc.streams[0];
  first.emit('closed');
  first.emit('error', new Error('late error')); // must not schedule a 2nd reopen
  await sleep(1100);
  assert.equal(grpc.streams.length, 2, 'exactly one new stream');
  // late data from the old session is ignored
  first.emit('newtx', { data: Buffer.from(JSON.stringify({ txid: txid(7), type: 't2t', expiry: 300 })), height: '0' });
  assert.ok(!svc.store.has(txid(7)));
  grpc.push(txid(7));
  assert.ok(svc.store.has(txid(7)));
  svc.stop();
});

test('watchdog: stuck task triggers a soft reset with a fresh mempool', async () => {
  const { svc, grpc } = makeService({ TASK_STUCK_MS: 30 });
  svc.start();
  await sleep(5);
  grpc.push(txid(1));
  assert.equal(svc.store.size, 1);
  grpc.hangTip = true;
  svc.tip = { ...svc.tip, at: 0 };
  svc.tasks.tip = null;
  svc.pollTip(); // hangs forever
  await sleep(50);
  grpc.hangTip = false;
  svc.watchdog();
  assert.equal(svc.counters.softResets, 1);
  assert.equal(svc.gen, 1);
  assert.equal(svc.store.size, 0, 'fresh mempool after reset');
  assert.equal(svc.server, 'b:2', 'failed over to next server');
  await sleep(5);
  assert.equal(svc.tip.height, 100, 'tip re-acquired after reset');
  svc.stop();
});

test('watchdog: silent lightwalletd → recreate client, then soft reset', async () => {
  const { svc, grpc } = makeService({ GRPC_STALE_MS: 20, GRPC_DEAD_MS: 60 });
  svc.start();
  await sleep(5);
  grpc.failTip = true;
  await sleep(30);
  svc.watchdog();
  assert.equal(svc.counters.clientRecreates, 1);
  assert.equal(svc.counters.softResets, 0);
  await sleep(40);
  svc.watchdog();
  assert.equal(svc.counters.softResets, 1);
  svc.stop();
});

test('late response from a replaced gRPC client cannot overwrite the tip', async () => {
  const { svc, grpc } = makeService();
  svc.start();
  await sleep(5);
  assert.equal(svc.tip.height, 100);

  let resolveOld;
  const oldClient = svc.client;
  grpc.getLatestBlock = (client) => {
    if (client === oldClient) {
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    }
    return Promise.resolve({ height: '200', hash: Buffer.alloc(32, 200) });
  };

  const stalePoll = svc.pollTip();
  await sleep(1);
  svc.recreateClient('test replacement');
  await svc.pollTip();
  assert.equal(svc.tip.height, 200);

  resolveOld({ height: '150', hash: Buffer.alloc(32, 150) });
  await stalePoll;
  assert.equal(svc.tip.height, 200);
  svc.stop();
});

test('tip regression for N polls → soft reset', async () => {
  const { svc, grpc } = makeService({ MAX_TIP_REGRESSIONS: 3 });
  svc.start();
  await sleep(5);
  grpc.tip = 90;
  await svc.pollTip();
  await svc.pollTip();
  assert.equal(svc.counters.softResets, 0);
  await svc.pollTip();
  assert.equal(svc.counters.softResets, 1);
  svc.stop();
});

test('reconcile that keeps timing out → soft reset', async () => {
  const { svc, grpc } = makeService({ RECONCILE_BUDGET_MS: 20, MAX_RECONCILE_FAILURES: 2, RPC_DEADLINE_MS: 30 });
  svc.start();
  await sleep(5);
  grpc.push(txid(1));
  grpc.transient.add(txid(1));
  await svc.reconcile('block', 100);
  assert.equal(svc.reconcileFailures, 1);
  await svc.reconcile('block', 100);
  assert.equal(svc.counters.softResets, 1);
  svc.stop();
});

test('expired txs are evicted locally', async () => {
  const { svc, grpc } = makeService();
  svc.start();
  await sleep(5);
  grpc.push(txid(1), { expiry: 101 });
  grpc.push(txid(2), { expiry: 500 });
  grpc.tip = 102;
  await svc.pollTip();
  assert.deepEqual(svc.store.ids(), [txid(2)]);
  svc.stop();
});

test('stream reconnect storm → soft reset', async () => {
  const { svc } = makeService();
  svc.start();
  await sleep(5);
  for (let i = 0; i < 45; i++) svc.openStream();
  assert.equal(svc.counters.softResets, 1);
  svc.stop();
});

test('too many soft resets → fatal (process restart by supervisor)', async () => {
  const { svc, fatal } = makeService({ MAX_RESETS_IN_WINDOW: 3 });
  svc.start();
  await sleep(5);
  for (let i = 0; i < 4; i++) svc.softReset(`test ${i}`);
  assert.equal(fatal.length, 1);
  assert.equal(svc.running, false);
});

test('mempool size cap → soft reset', async () => {
  const { svc, grpc } = makeService({ MAX_MEMPOOL_TXS: 3 });
  svc.start();
  await sleep(5);
  for (let i = 1; i <= 4; i++) grpc.push(txid(i));
  assert.equal(svc.counters.softResets, 1);
  assert.equal(svc.store.size, 0);
  svc.stop();
});
