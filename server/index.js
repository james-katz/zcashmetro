/**
 * ZcashMetro server — supervisor entry point.
 *
 * Runs the API (app.js) in a child process and watches it:
 *
 *  - The worker sends a heartbeat every HEARTBEAT_MS from its event loop.
 *    If heartbeats stop for HEARTBEAT_TIMEOUT_MS (infinite loop, deadlock,
 *    runaway synchronous work) the worker is SIGKILLed.
 *  - Whenever the worker exits (crash, fatal self-check, kill) a brand new
 *    one is started with a completely fresh in-memory mempool.
 *  - Restarts back off exponentially (1s → 30s) if the worker keeps dying
 *    quickly, and the backoff resets after a minute of healthy uptime.
 *
 * A JavaScript infinite loop can't be detected from inside the same thread,
 * which is why this lives in a separate process.
 */
process.env.ZM_ROLE = 'supervisor';

const { fork } = require('child_process');
const path = require('path');
const cfg = require('./lib/config');
const log = require('./lib/logger')('main');

const WORKER = path.join(__dirname, 'app.js');
const MIN_BACKOFF = 1000;
const MAX_BACKOFF = 30000;

let child = null;
let lastBeat = 0;
let lastStatus = null;
let startedAt = 0;
let backoff = MIN_BACKOFF;
let restarts = 0;
let stopping = false;
let restartTimer = null;

function startWorker() {
  restartTimer = null;
  startedAt = Date.now();
  lastBeat = Date.now(); // grace period for boot
  lastStatus = null;
  child = fork(WORKER, process.argv.slice(2), {
    cwd: __dirname,
    env: { ...process.env, ZM_ROLE: 'worker' },
    stdio: 'inherit',
  });
  log.info(`Worker started (pid ${child.pid}${restarts ? `, restart #${restarts}` : ''})`);

  child.on('message', (m) => {
    if (m && m.type === 'hb') {
      lastBeat = Date.now();
      if (m.status !== lastStatus) {
        log.info(`Worker status: ${m.status} (epoch ${m.epoch}, mempool ${m.mempool})`);
        lastStatus = m.status;
      }
    }
  });

  const proc = child;
  proc.on('exit', (code, signal) => {
    if (child === proc) child = null;
    if (stopping) {
      log.info('Worker stopped.');
      process.exit(0);
    }
    const uptime = Date.now() - startedAt;
    if (uptime > 60000) backoff = MIN_BACKOFF;
    restarts++;
    log.warn(
      `Worker exited (code ${code}, signal ${signal}) after ${Math.round(uptime / 1000)}s — ` +
        `restarting with fresh state in ${backoff}ms`,
    );
    restartTimer = setTimeout(startWorker, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  });
}

// Liveness check
setInterval(() => {
  if (!child || stopping) return;
  const silent = Date.now() - lastBeat;
  if (silent > cfg.HEARTBEAT_TIMEOUT_MS) {
    log.error(
      `Worker unresponsive for ${Math.round(silent / 1000)}s (event loop blocked / infinite loop?) — killing it`,
    );
    lastBeat = Date.now(); // don't re-kill while it dies
    child.kill('SIGKILL');
  }
}, 2000);

function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log.info(`${sig} received — stopping worker`);
  if (restartTimer) clearTimeout(restartTimer);
  if (!child) process.exit(0);
  child.kill('SIGTERM');
  setTimeout(() => {
    if (child) child.kill('SIGKILL');
    process.exit(0);
  }, 5000).unref();
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGUSR2']) process.on(sig, () => shutdown(sig));

startWorker();
