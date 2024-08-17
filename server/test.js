const native = require('./index.node');
const grpc = require('./grpc_connector');

const client = grpc.init('na-ewr.zec.rocks:443');  

txid = "4a38e963ebfc7197356ddca5b7d138aeaec384002113d35cbc98311733c29d46";
grpc.getTransaction(client, txid).then(tx => {
    // console.log(Buffer.from(tx.data, 'hex'))
    const data = native.getTransactionData(Buffer.from(tx.data, 'hex').toString('hex'));
    dataJson = JSON.parse(data);

    let txtype = "unknown";
    if (dataJson.n_transparent_vin > 0) {
        if (dataJson.n_transparent_vout > 0) {
            txtype = "t2t";
        } else if (dataJson.n_sapling_output > 0) {
            txtype = "t2z";
        } else if (dataJson.n_orchard_action > 0) {
            txtype = "t2o";
        }
    } else if (dataJson.n_sapling_spend > 0) {
        if (dataJson.n_transparent_vout > 0) {
            txtype = "z2t";
        } else if (dataJson.n_sapling_output > 0) {
            txtype = "z2z";
        } else if (dataJson.n_orchard_action > 0) {
            txtype = "z2o";
        }
    } else if (dataJson.n_orchard_action > 0) {
        if (dataJson.n_transparent_vout > 0) {
            txtype = "o2t";
        } else if (dataJson.n_sapling_output > 0) {
            txtype = "o2z";
        } else {
            txtype = "o2o";
        }
    }
    console.log(dataJson);
    console.log(txtype)
});

