const { EventEmitter } = require('events');
const path = require('path');

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Resolve relative to this file so the server can be started from any cwd.
const PROTO_PATH = path.join(__dirname, 'proto', 'service.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const compactTxStreamer = grpc.loadPackageDefinition(packageDefinition)
  .cash.z.wallet.sdk.rpc.CompactTxStreamer;

/** Default deadline for unary calls. A call without a deadline can hang forever. */
let defaultDeadlineMs = 8000;

/** gRPC status codes we care about. */
const Status = grpc.status;

/**
 * Create a new gRPC client connected to the given lightwalletd server.
 * @param {string} serverUri  e.g. "server.example.com:9067"
 * @param {{ plaintext?: boolean, deadlineMs?: number }} [opts]
 * @returns {object} gRPC client instance
 */
function init(serverUri, opts = {}) {
  if (opts.deadlineMs) defaultDeadlineMs = opts.deadlineMs;
  const options = {
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
    // Reconnect quickly after transient failures instead of backing off for minutes.
    'grpc.initial_reconnect_backoff_ms': 1000,
    'grpc.max_reconnect_backoff_ms': 10000,
  };
  const creds = opts.plaintext ? grpc.credentials.createInsecure() : grpc.credentials.createSsl();
  return new compactTxStreamer(serverUri, creds, options);
}

/**
 * Close a client and its underlying channel (cancels in-flight calls).
 * @param {object} client
 */
function close(client) {
  try {
    client.close();
  } catch (_) {
    /* ignore */
  }
}

/**
 * Wrap a unary call in a promise with a hard deadline.
 * @param {object} client
 * @param {string} method
 * @param {object} req
 * @param {number} [deadlineMs]
 */
function unary(client, method, req, deadlineMs = defaultDeadlineMs) {
  return new Promise((resolve, reject) => {
    try {
      client[method](req, { deadline: Date.now() + deadlineMs }, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get the latest block height and hash from the chain.
 * @param {object} client  gRPC client
 * @returns {Promise<{ height: string, hash: Buffer }>}
 */
function getLatestBlock(client, deadlineMs) {
  return unary(client, 'GetLatestBlock', {}, deadlineMs);
}

/**
 * Get a compact block at the given height.
 * NOTE: some lightwalletd versions fail to parse blocks with newer tx versions.
 * @param {object} client  gRPC client
 * @param {number} height  Block height
 * @returns {Promise<object>} CompactBlock
 */
function getBlock(client, height, deadlineMs) {
  return unary(client, 'GetBlock', { height }, deadlineMs);
}

/**
 * Get the tree state (includes block time) at a given height.
 * @param {object} client
 * @param {number} height
 * @returns {Promise<{ height: string, hash: string, time: number }>}
 */
function getTreeState(client, height, deadlineMs) {
  return unary(client, 'GetTreeState', { height }, deadlineMs);
}

/**
 * Fetch a raw transaction by its txid (hex string).
 * @param {object} client  gRPC client
 * @param {string} txid    Transaction ID in hex
 * @returns {Promise<{ data: Buffer, height: string }>}
 */
function getTransaction(client, txid, deadlineMs) {
  return unary(client, 'GetTransaction', { hash: Buffer.from(txid, 'hex').reverse() }, deadlineMs);
}

/**
 * Get all current mempool transactions (one-shot, non-streaming).
 * @param {object} client  gRPC client
 * @returns {Promise<object[]>} Array of CompactTx
 */
function getMempoolTx(client, deadlineMs = defaultDeadlineMs) {
  return new Promise((resolve, reject) => {
    try {
      const txns = [];
      const call = client.GetMempoolTx({}, { deadline: Date.now() + deadlineMs });
      call.on('data', (tx) => txns.push(tx));
      call.on('end', () => resolve(txns));
      call.on('error', (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Open a persistent mempool stream that emits events as new transactions
 * arrive. Emits 'newtx' for each transaction, then EXACTLY ONE terminal event:
 * 'closed' when the stream ends (typically at a block boundary) or 'error'
 * on failure. Call `emitter.cancel()` to abort it (no terminal event is
 * emitted for a local cancel).
 * @param {object} client  gRPC client
 * @returns {EventEmitter & { cancel: () => void }}
 */
function getMempoolStream(client) {
  const emitter = new EventEmitter();
  let finished = false;
  const call = client.GetMempoolStream({});

  const finish = (event, arg) => {
    if (finished) return;
    finished = true;
    emitter.emit(event, arg);
  };

  call.on('data', (tx) => {
    if (!finished) emitter.emit('newtx', tx);
  });
  call.on('end', () => finish('closed'));
  call.on('error', (err) => {
    if (err && err.code === Status.CANCELLED && emitter.cancelledLocally) {
      finished = true;
      return;
    }
    finish('error', err);
  });

  emitter.cancelledLocally = false;
  emitter.cancel = () => {
    emitter.cancelledLocally = true;
    finished = true;
    try {
      call.cancel();
    } catch (_) {
      /* ignore */
    }
  };
  return emitter;
}

/**
 * Get lightwalletd server information.
 * @param {object} client  gRPC client
 * @returns {Promise<object>} LightdInfo
 */
function getLightdInfo(client, deadlineMs) {
  return unary(client, 'GetLightdInfo', {}, deadlineMs);
}

/**
 * True if the error means "this transaction does not exist" (as opposed to a
 * transient network problem, which must never cause us to drop data).
 * @param {any} err
 */
function isNotFound(err) {
  if (!err) return false;
  if (err.code === Status.NOT_FOUND) return true;
  const d = String(err.details || err.message || '');
  return /-5:|not found|No such mempool or blockchain transaction/i.test(d);
}

module.exports = {
  Status,
  init,
  close,
  getLatestBlock,
  getBlock,
  getTreeState,
  getTransaction,
  getMempoolTx,
  getMempoolStream,
  getLightdInfo,
  isNotFound,
};
