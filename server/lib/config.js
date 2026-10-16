/**
 * Central configuration. Every knob can be overridden by an environment
 * variable so production tuning never requires code changes.
 */

const num = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const bool = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return v === '1' || v.toLowerCase() === 'true';
};

module.exports = {
  // --- HTTP ---
  HOST: process.env.HOST || '0.0.0.0',
  PORT: num('PORT', 3000),
  USE_HTTPS: bool('USE_HTTPS', false),
  SSL_KEY: process.env.SSL_KEY || 'privkey.pem',
  SSL_CERT: process.env.SSL_CERT || 'cert.pem',

  // --- lightwalletd ---
  // Comma-separated list; the service fails over to the next one when unhealthy.
  GRPC_SERVERS: (process.env.GRPC_SERVER_URL || 'infra.zcashbr.com:9067')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  GRPC_PLAINTEXT: bool('GRPC_PLAINTEXT', false),
  RPC_DEADLINE_MS: num('RPC_DEADLINE_MS', 8000),

  // --- Chain tip polling ---
  TIP_POLL_MS: num('TIP_POLL_MS', 3000),

  // --- Mempool stream ---
  // Max lifetime of one stream session before it is rotated (re-opened).
  STREAM_MAX_AGE_MS: num('STREAM_MAX_AGE_MS', 5 * 60 * 1000),
  // Rotate the stream if the tip advanced by this many blocks and it never closed.
  STREAM_MAX_BLOCKS: num('STREAM_MAX_BLOCKS', 2),

  // --- Reconciliation (detect mined / dropped txs) ---
  RECONCILE_INTERVAL_MS: num('RECONCILE_INTERVAL_MS', 60 * 1000),
  RECONCILE_CONCURRENCY: num('RECONCILE_CONCURRENCY', 8),
  RECONCILE_BUDGET_MS: num('RECONCILE_BUDGET_MS', 60 * 1000),
  // How many recent blocks of "mined" txids to remember (for the train animation).
  MINED_MEMORY_BLOCKS: num('MINED_MEMORY_BLOCKS', 20),

  // --- Self-healing watchdog ---
  WATCHDOG_INTERVAL_MS: num('WATCHDOG_INTERVAL_MS', 5000),
  // No successful tip poll for this long → recreate the gRPC client (failover).
  GRPC_STALE_MS: num('GRPC_STALE_MS', 45 * 1000),
  // No successful tip poll for this long → full soft reset (fresh mempool).
  GRPC_DEAD_MS: num('GRPC_DEAD_MS', 3 * 60 * 1000),
  // A background task running longer than this is considered stuck.
  TASK_STUCK_MS: num('TASK_STUCK_MS', 90 * 1000),
  // Consecutive failed/aborted reconciles before a soft reset.
  MAX_RECONCILE_FAILURES: num('MAX_RECONCILE_FAILURES', 3),
  // Tip going backwards for this many consecutive polls → soft reset.
  MAX_TIP_REGRESSIONS: num('MAX_TIP_REGRESSIONS', 5),
  // Hard sanity cap on mempool size.
  MAX_MEMPOOL_TXS: num('MAX_MEMPOOL_TXS', 20000),
  // A tx we still hold this long is evicted locally (normal expiry is ~50 min).
  MAX_TX_AGE_MS: num('MAX_TX_AGE_MS', 6 * 60 * 60 * 1000),
  // Too many soft resets in this window → exit and let the supervisor restart us.
  RESET_WINDOW_MS: num('RESET_WINDOW_MS', 10 * 60 * 1000),
  MAX_RESETS_IN_WINDOW: num('MAX_RESETS_IN_WINDOW', 5),
  // Event-loop lag considered pathological (ms).
  MAX_LOOP_LAG_MS: num('MAX_LOOP_LAG_MS', 5000),
  // RSS memory ceiling (MB) → exit and let the supervisor restart us.
  MAX_RSS_MB: num('MAX_RSS_MB', 1024),

  // --- Supervisor ---
  HEARTBEAT_MS: num('HEARTBEAT_MS', 2000),
  HEARTBEAT_TIMEOUT_MS: num('HEARTBEAT_TIMEOUT_MS', 30 * 1000),

  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};
