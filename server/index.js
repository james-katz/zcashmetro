const express = require('express');
const cors = require('cors');

const native = require('./index.node');

const sequelize = require('./database/index.js');

const grpc = require('./grpc_connector');

const https = require('https');
const fs = require('fs');

const useHttps = false;

const app = express();
app.use(cors()); // to allow cross origin requests

const PORT = process.env.PORT || 3000;
const GRPC_SERVER = process.env.GRPC_SERVER_URL || 'infra.zcashbr.com:9067';

// Initialize the gRPC connector
const client = grpc.init(GRPC_SERVER);

console.log(native.hello());

/** In-memory list of mempool transactions (mirrors the DB for fast lookups). */
let mempoolTx = [];

/** Simple lock to avoid concurrent DB writes. */
let dbLock = false;

/**
 * Classify a transaction by its input/output pool types.
 * @param {{ n_transparent_vin: number, n_transparent_vout: number, n_sapling_spend: number, n_sapling_output: number, n_orchard_action: number }} tx
 * @returns {string} Classification like "t2t", "t2z", "z2z", "o2o", etc.
 */
function classifyTxType(tx) {
  if (tx.n_transparent_vin > 0) {
    if (tx.n_transparent_vout > 0) return 't2t';
    if (tx.n_sapling_output > 0) return 't2z';
    if (tx.n_orchard_action > 0) return 't2o';
  } else if (tx.n_sapling_spend > 0) {
    if (tx.n_transparent_vout > 0) return 'z2t';
    if (tx.n_sapling_output > 0) return 'z2z';
    if (tx.n_orchard_action > 0) return 'z2o';
  } else if (tx.n_orchard_action > 0) {
    if (tx.n_transparent_vout > 0) return 'o2t';
    if (tx.n_sapling_output > 0) return 'o2z';
    return 'o2o';
  }
  return 'unknown';
}

/**
 * Insert a transaction into the SQLite database.
 * @param {{ txid: string, n_transparent_vin: number, n_transparent_vout: number, n_sapling_spend: number, n_sapling_output: number, n_orchard_action: number }} tx
 */
async function addTxToDatabase(tx) {
  const txtype = classifyTxType(tx);
  try {
    const rec = await sequelize.models.transaction.create({
      id: tx.txid,
      type: txtype,
    });
    if (rec) {
      console.log(`Added ${tx.txid}`);
    }
  } catch (e) {
    console.log('Unable to add tx:', tx.txid);
  }
}

// ---------------------------------------------------------------------------
// API Endpoints (kept exactly as before for dependent projects)
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  res.send('Hello from Express!');
});

app.get('/latestblock', async (req, res) => {
  try {
    const block = await grpc.getLatestBlock(client);
    res.json({ height: block.height });
  } catch (err) {
    console.error('Failed to get latest block:', err.message);
    res.status(500).json({ error: 'Failed to get latest block' });
  }
});

app.get('/txinfo', async (req, res) => {
  const txid = req.query.txid;
  try {
    if (!txid) throw new Error('txid is undefined');

    const tx = await grpc.getTransaction(client, txid);
    console.log('tx is mined in height:', tx.height);
    if (tx.height > 0) {
      res.json({ height: tx.height });
    } else {
      res.json({ height: -1 });
    }
  } catch (e) {
    // tx is invalid somehow — if it's in db, destroy it
    const TxModel = sequelize.models.transaction;
    try {
      if (!txid) throw new Error('txid is undefined');
      const t = await TxModel.findOne({ where: { id: txid } });
      if (t) {
        await t.destroy();
      }
    } catch (dbErr) {
      console.log('tx not in database or txid is undefined');
    }
    res.json({ height: -1, error: true });
  }
});

app.get('/mempool', async (req, res) => {
  let tx_list = [];
  try {
    const db_tx = await sequelize.models.transaction.findAll();
    tx_list = db_tx.map((tx) => ({
      txid: tx.id,
      type: tx.type,
    }));
  } catch (e) {
    console.log(e);
  }
  res.json(tx_list);
});

// ---------------------------------------------------------------------------
// HTTPS / HTTP listener
// ---------------------------------------------------------------------------

if (useHttps) {
  const options = {
    key: fs.readFileSync('privkey.pem'),
    cert: fs.readFileSync('cert.pem'),
  };
  https.createServer(options, app).listen(PORT);
  console.log(`App listening at https://localhost:${PORT}`);
} else {
  app.listen(PORT, () => {
    console.log(`App listening at http://localhost:${PORT}`);
  });
}

// ---------------------------------------------------------------------------
// Database initialization & mempool stream
// ---------------------------------------------------------------------------

sequelize
  .authenticate()
  .then(async () => {
    console.log('Connection to SQLite has been established successfully.');

    try {
      // Start with a clean database
      const TxModel = sequelize.models.transaction;
      await TxModel.truncate();

      listenForMempool();
    } catch (e) {
      console.log(e);
    }
  })
  .catch((err) => {
    console.error('Unable to connect to the database:', err);
  });

/**
 * Open a gRPC mempool stream, process incoming transactions, and handle
 * stream closure (new block mined) by cleaning up mined transactions.
 *
 * When the stream closes (block boundary), we iterate the in-memory list
 * with a proper for...of + await so DB operations finish before we update
 * the list.
 */
function listenForMempool() {
  console.log('Starting new stream');
  let txListener = grpc.getMempoolStream(client);

  txListener.on('newtx', async (tx) => {
    if (dbLock) return;

    const txdata = native.getTransactionData(
      Buffer.from(tx.data, 'hex').toString('hex'),
      tx.height
    );
    const txjson = JSON.parse(txdata);

    const newtx = {
      txid: txjson.txid.replaceAll('"', ''),
      n_transparent_vin: txjson.n_transparent_vin,
      n_transparent_vout: txjson.n_transparent_vout,
      n_sapling_spend: txjson.n_sapling_spend,
      n_sapling_output: txjson.n_sapling_output,
      n_orchard_action: txjson.n_orchard_action,
      height: tx.height,
      expiry: txjson.n_expiry_height,
    };

    if (!mempoolTx.some((t) => t.txid === newtx.txid)) {
      if (newtx.expiry > 0) {
        await addTxToDatabase(newtx);
        mempoolTx.push(newtx);
      }
    }
  });

  txListener.on('closed', async () => {
    console.log('Stream closed.');
    dbLock = true;

    const TxModel = sequelize.models.transaction;
    const stillUnmined = [];

    // Use for...of so each await completes before the next iteration
    for (const tx of mempoolTx) {
      try {
        const t = await grpc.getTransaction(client, tx.txid);
        if (t.height > 0) {
          console.log(`${tx.txid} mined, removing it from db ...`);
          await TxModel.destroy({ where: { id: tx.txid } });
        } else {
          console.log(`${tx.txid} not mined yet, keep it until it gets mined`);
          stillUnmined.push(tx);
        }
      } catch (err) {
        console.log("Transaction doesn't exist, remove it from db");
        try {
          await TxModel.destroy({ where: { id: tx.txid } });
        } catch (destroyErr) {
          console.log('tx is undefined');
        }
      }
    }

    mempoolTx = stillUnmined;
    txListener = undefined;
    dbLock = false;

    // Wait a sec before opening a new stream, just in case.
    setTimeout(() => {
      listenForMempool();
    }, 1000);
  });

  txListener.on('error', (e) => {
    console.log(`Stream closed with error ${e}`);
    txListener = undefined;
    dbLock = false;

    // Wait 5 sec before opening a new stream, just in case.
    setTimeout(() => {
      listenForMempool();
    }, 5 * 1000);
  });
}
