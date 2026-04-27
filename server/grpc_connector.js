const { EventEmitter } = require('events');

const PROTO_PATH = './proto/service.proto';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const compactTxStreamer = grpc.loadPackageDefinition(packageDefinition)
  .cash.z.wallet.sdk.rpc.CompactTxStreamer;

/**
 * Create a new gRPC client connected to the given lightwalletd server.
 * @param {string} serverUri  e.g. "server.example.com:9067"
 * @returns {object} gRPC client instance
 */
function init(serverUri) {
  const options = { 'grpc.max_receive_message_length': 1752460652 };
  return new compactTxStreamer(serverUri, grpc.credentials.createSsl(), options);
}

/**
 * Get the latest block height and hash from the chain.
 * @param {object} client  gRPC client
 * @returns {Promise<{ height: string, hash: Buffer }>}
 */
function getLatestBlock(client) {
  return new Promise((resolve, reject) => {
    try {
      client.GetLatestBlock({}, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    } catch (err) {
      console.log('getLatestBlock error', err);
      reject(err);
    }
  });
}

/**
 * Get a compact block at the given height.
 * @param {object} client  gRPC client
 * @param {number} height  Block height
 * @returns {Promise<object>} CompactBlock
 */
function getBlock(client, height) {
  return new Promise((resolve, reject) => {
    try {
      client.GetBlock({ height: height }, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    } catch (err) {
      console.log('getBlock error', err);
      reject(err);
    }
  });
}

/**
 * Fetch a raw transaction by its txid (hex string).
 * @param {object} client  gRPC client
 * @param {string} txid    Transaction ID in hex
 * @returns {Promise<{ data: Buffer, height: number }>}
 */
function getTransaction(client, txid) {
  return new Promise((resolve, reject) => {
    try {
      client.getTransaction(
        { hash: Buffer.from(txid, 'hex').reverse() },
        (err, res) => {
          if (err) return reject(err);
          resolve(res);
        }
      );
    } catch (err) {
      console.log('getTransaction error', err);
      reject(err);
    }
  });
}

/**
 * Get all current mempool transactions (one-shot, non-streaming).
 * @param {object} client  gRPC client
 * @returns {Promise<object[]>} Array of CompactTx
 */
function getMempoolTx(client) {
  return new Promise((resolve, reject) => {
    try {
      const txns = [];
      const call = client.GetMempoolTx({});

      call.on('data', (tx) => {
        txns.push(tx);
      });

      call.on('end', () => {
        resolve(txns);
      });

      call.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      console.log('getMempoolTx error', err);
      reject(err);
    }
  });
}

/**
 * Open a persistent mempool stream that emits events as new transactions
 * arrive. Emits 'newtx' for each transaction, 'closed' when the stream
 * ends (typically at a block boundary), and 'error' on failures.
 * @param {object} client  gRPC client
 * @returns {EventEmitter}
 */
function getMempoolStream(client) {
  const emitter = new EventEmitter();
  const call = client.GetMempoolStream({});

  call.on('data', (tx) => {
    emitter.emit('newtx', tx);
  });

  call.on('end', () => {
    emitter.emit('closed');
  });

  call.on('error', (err) => {
    emitter.emit('error', err);
  });

  return emitter;
}

/**
 * Get lightwalletd server information.
 * @param {object} client  gRPC client
 * @returns {Promise<object>} LightdInfo
 */
function getLightdInfo(client) {
  return new Promise((resolve, reject) => {
    try {
      client.getLightdInfo({}, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    } catch (err) {
      console.log('getLightdInfo error', err);
      reject(err);
    }
  });
}

module.exports = {
  init,
  getLatestBlock,
  getBlock,
  getTransaction,
  getMempoolTx,
  getMempoolStream,
  getLightdInfo,
};
