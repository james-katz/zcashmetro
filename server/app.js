/**
 * ZcashMetro API worker.
 *
 * Normally started by the supervisor (index.js), which restarts it with a
 * completely fresh state if it crashes, exits, or stops sending heartbeats
 * (e.g. an infinite loop blocking the event loop). Can also be run
 * standalone with `node app.js` for debugging.
 *
 * All endpoints are served from memory — no request ever waits on
 * lightwalletd except /txinfo for unknown txids (and that has a deadline).
 */
process.env.ZM_ROLE = process.env.ZM_ROLE || 'worker';

const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');

const cfg = require('./lib/config');
const createLogger = require('./lib/logger');
const decoder = require('./lib/decoder');
const MempoolService = require('./lib/mempool-service');

const log = createLogger('http');
const supervised = typeof process.send === 'function';

// ---------------------------------------------------------------------------
// Crash policy: any unexpected error → exit; the supervisor restarts us clean.
// ---------------------------------------------------------------------------
function die(reason, err) {
  log.error(`FATAL ${reason}:`, err && err.stack ? err.stack : err);
  setTimeout(() => process.exit(1), 100);
}
process.on('uncaughtException', (e) => die('uncaughtException', e));
process.on('unhandledRejection', (e) => die('unhandledRejection', e));
if (supervised) {
  // Supervisor died → don't linger as an orphan holding the port.
  process.on('disconnect', () => {
    log.warn('Supervisor disconnected — exiting');
    process.exit(0);
  });
}

if (!decoder.isLoaded()) {
  die('native decoder failed to load (run `npm run build-release` in server/)', decoder.loadError());
} else if (decoder.mode() === 'legacy-json') {
  log.warn(
    `Native decoder: ${decoder.hello()} (legacy compatibility mode). ` +
      'Rebuild index.node with `npm run build-release` during the next deployment.',
  );
} else {
  log.info(`Native decoder: ${decoder.hello()} (${decoder.mode()})`);
}

const svc = new MempoolService(cfg);

// ---------------------------------------------------------------------------
// Response caching — many clients poll every second; serialize once per change.
// ---------------------------------------------------------------------------
const cache = { mempoolKey: null, mempool: '[]', stateKey: null, state: null };

function mempoolJson() {
  const key = `${svc.gen}:${svc.store.version}`;
  if (cache.mempoolKey !== key) {
    cache.mempool = JSON.stringify(svc.store.list());
    cache.mempoolKey = key;
  }
  return cache.mempool;
}

function stateJson() {
  const t = svc.tip;
  const status = svc.status;
  const key = `${svc.gen}:${svc.store.version}:${t && t.height}:${t && t.hash}:${status}`;
  if (cache.stateKey !== key) {
    cache.state = JSON.stringify({
      epoch: svc.gen,
      status,
      height: t ? t.height : null,
      blockTime: t ? t.blockTime : null,
      mempool: svc.store.list(),
      mined: svc.store.minedList(),
    });
    cache.stateKey = key;
  }
  return cache.state;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(cors()); // to allow cross origin requests
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get(['/', '/api'], (req, res) => {
  res.send('Hello from Express!');
});

/** Legacy: { height, blockTime } */
app.get(['/latestblock', '/api/latestblock'], (req, res) => {
  const t = svc.tip;
  if (!t) return res.status(503).json({ error: 'Failed to get latest block' });
  res.json({ height: t.height, blockTime: t.blockTime });
});

/** Legacy: [{ txid, type }] */
app.get(['/mempool', '/api/mempool'], (req, res) => {
  res.type('application/json').send(mempoolJson());
});

/** Legacy: { height } (mined) | { height: -1 } (pending) | { height: -1, error: true } */
app.get(['/txinfo', '/api/txinfo'], async (req, res) => {
  const txid = String(req.query.txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(txid)) return res.json({ height: -1, error: true });
  try {
    res.json(await svc.lookupTx(txid));
  } catch (e) {
    res.json({ height: -1, error: true });
  }
});

/**
 * New: atomic snapshot used by the frontend.
 * { epoch, status, height, blockTime, mempool: [{txid,type}], mined: [{txid,height}] }
 */
app.get(['/state', '/api/state'], (req, res) => {
  if (!svc.tip) return res.status(503).json({ error: 'starting', status: svc.status, epoch: svc.gen });
  res.type('application/json').send(stateJson());
});

/** New: self-diagnostics. 200 when healthy, 503 otherwise. */
app.get(['/health', '/api/health'], (req, res) => {
  const h = svc.health();
  res.status(h.status === 'ok' ? 200 : 503).json(h);
});

app.use((err, req, res, _next) => {
  log.error('Request error:', err && err.message);
  res.status(500).json({ error: 'internal error' });
});

// ---------------------------------------------------------------------------
// HTTPS / HTTP listener
// ---------------------------------------------------------------------------
let server;
if (cfg.USE_HTTPS) {
  const options = { key: fs.readFileSync(cfg.SSL_KEY), cert: fs.readFileSync(cfg.SSL_CERT) };
  server = https.createServer(options, app);
} else {
  server = http.createServer(app);
}
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.on('error', (e) => die('HTTP server error', e));
server.listen(cfg.PORT, cfg.HOST, () => {
  log.info(`App listening at ${cfg.USE_HTTPS ? 'https' : 'http'}://${cfg.HOST}:${cfg.PORT}`);
});

svc.start();

// ---------------------------------------------------------------------------
// Heartbeat → supervisor. Sent from the event loop, so if the loop is blocked
// (infinite loop, runaway sync work) heartbeats stop and we get SIGKILLed.
// ---------------------------------------------------------------------------
if (supervised) {
  setInterval(() => {
    try {
      process.send({ type: 'hb', status: svc.status, epoch: svc.gen, mempool: svc.store.size });
    } catch (_) {
      /* channel closed */
    }
  }, cfg.HEARTBEAT_MS);
}

function shutdown(sig) {
  log.info(`${sig} received — shutting down`);
  svc.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, svc };
