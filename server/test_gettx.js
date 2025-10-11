const grpc = require('./grpc_connector');
const native = require('./index.node');

const urlList = [
    'lwd1.zcash-infra.com:9067',
    'zec.rocks:443',
    'lightwalletd.stakehold.rs:443',
    'zaino.unsafe.zec.rocks:443',
    'zcashd.zec.rocks:443',
]

// First, get any tx in the mempool
const client = grpc.init(urlList[0]);
const mempool = client.GetMempoolStream({});

let unminedTx = '';
mempool.on('data', async (tx) => {   
    if(!unminedTx) {
        unminedTx = tx;

        const txdata = native.getTransactionData(Buffer.from(tx.data, 'hex').toString('hex'), tx.height);
        const txjson = JSON.parse(txdata);
        const txid = txjson.txid.replaceAll('"', '');

        console.log(`Found new tx on mempool: ${txid}`);

        for(const url of urlList) {            
            console.log(`Using ${url} ...`);
            const lc = grpc.init(url);
            const info = await grpc.getLightdInfo(lc);
            console.log(`${info.zcashdSubversion} ${info.version}`);
            const chainTip = await grpc.getLatestBlock(lc);
            console.log(`Server latest block: ${chainTip.height}`);
            
            const t = await grpc.getTransaction(client, txid);
            console.log(`getTransaction RPC answer: ${t.height}`);
            console.log("\n======\n")
        }
        return;
    }
});
