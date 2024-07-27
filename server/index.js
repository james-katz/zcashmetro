const express = require('express');
const cors = require('cors');

const native = require('./index.node');

const sequelize = require('./database/index.js');

const grpc = require('./grpc_connector');

const https = require('https');
const fs = require('fs');

const useHttps = false;

const app = express();
app.use(cors()) // to allow cross origin requests

const PORT = process.env.PORT || 3000;

// Initialize the gRPC connector
const client = grpc.init('na-ewr.zec.rocks:443');  

console.log(native.hello());

let mempoolTx = [];
let dbLock = false;

async function addTxToDatabase(tx) {
  dbLock = true;
  const rec = await sequelize.models.transaction.create( {
    id: tx.txid,
    type: 'regular',      
  });
  if(rec instanceof sequelize.models.transaction) {
    console.log(`Added ${tx.txid}`);
  }
  dbLock = false;
}

app.get('/', (req, res) => {
  res.send('Hello from Express!');
});

app.get('/latestblock', async (req, res) => {
  grpc.getLatestBlock(client).then((block) => {
    res.json({height: block.height});
  });
});

app.get('/txinfo', async (req, res) => {    
  let tx;
  try {
    tx = await grpc.getTransaction(client, req.query.txid);
    // Workaround to work with uint64. -1 means a tx that wasn't minet yet
    if((tx.height - (2**64-1) - 1) != -1) {
      res.json({height: tx.height})        
    }
    else {
      res.json({height: -1});
    }
  }
  catch(e) {
    // tx is invalid somehow, if it's in db, destroy it
    const TxModel = sequelize.models.transaction;  
    TxModel.findOne({where: {id: tx}}).then(async (t) => {
      await t.destroy();
    });
    res.json({height: -1, error: true});
  }
});

app.get('/mempool', async (req, res) => {
  let tx_list = new Map();
  try {
    const db_tx = await sequelize.models.transaction.findAll();
    tx_list = db_tx.map((tx) => {
      return {
        txid: tx.id,
        type: tx.type
      }
    });
  }
  catch(e) {
    console.log(e);
  }
  res.json(tx_list);
});

if(useHttps) {
  const options = {
      key: fs.readFileSync('privkey.pem'),
      cert: fs.readFileSync('cert.pem')
  };
  https.createServer(options, app).listen(PORT);
  console.log(`App listening at https://localhost:${PORT}`)
}
else {
  app.listen(PORT, () => {
      console.log(`App listening at http://localhost:${PORT}`)
  });
}

sequelize.authenticate().then(async () => {
  console.log('Connection to SQLite has been established successfully.');  
  
  try {    
    // First we delete everything from databse, so we have a clean start
    const TxModel = sequelize.models.transaction;  
    await TxModel.truncate();
    
    listenForMempool();
    
  }
  catch(e) {
    console.log(e);
  }

}).catch(err => {
  console.error('Unable to connect to the database:', err);
});

async function listenForMempool() {
  console.log("Starting new stream")
  let txListener = grpc.getMempoolStream(client);

  txListener.on('newtx', async(tx) => {        
    const txdata = native.getTransactionData(Buffer.from(tx.data, 'hex').toString('hex'));
    const txjson = JSON.parse(txdata);
    
    const newtx = {
      txid: txjson.txid.replaceAll('"', ''),
      height: tx.height,
    };
    // console.log(newtx);

    if(mempoolTx.filter((t) => t.txid == newtx.txid).length == 0) {
      await addTxToDatabase(newtx);
      mempoolTx.push(newtx);
    }
  });

  txListener.on('closed', async () => {
    console.log("Stream closed.");
    // This block is done, remove mined tx from db
    const TxModel = sequelize.models.transaction;  
    dbLock = true;

    // Create a temporary list to hold unimed tx
    const temp = [];
    for(tx of mempoolTx) {
      const t = await grpc.getTransaction(client, tx.txid);
      // console.log(t.height)
      // Workaround to work with uint64. -1 means a tx that wasn't minet yet
      if((t.height - (2**64-1) - 1) != -1) {
        console.log(`${tx.txid} mined, removing it from db ...`);
        await TxModel.destroy({where: {id: tx.txid}});
      }
      else {
        console.log(`${tx.txid} not mined yet, keep it until it get mined`);
        temp.push(tx);
      }
    }

    mempoolTx = temp;
    txListener = undefined;
    dbLock = false;

    // Wait a sec before opening a new stream, just in case.
    setTimeout(() => {
      listenForMempool();
    }, 1000);
    
  });
}
