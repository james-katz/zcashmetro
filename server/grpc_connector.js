const { EventEmitter } = require('events');

const PROTO_PATH = './proto/service.proto';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const packageDefinition = protoLoader.loadSync(
    PROTO_PATH,
    {
        keepCase: true,
        longs: String,
        enums: String,        
        defaults: true,
        oneofs: true,
        // bytes: Array
    }   
);

const compactTxStreamer = grpc.loadPackageDefinition(packageDefinition).cash.z.wallet.sdk.rpc.CompactTxStreamer;
// const eventEmitter = new EventEmitter();

function init(serverUri) {
    // let options = { 'grpc.max_receive_message_length': 1752460652};
    const options = {};
    return client = new compactTxStreamer(serverUri, grpc.credentials.createSsl(), options);
}

function getLatestBlock(client) {
    return new Promise((resolve, reject) => {        
        try {
            client.GetLatestBlock({}, (err, res) => {
                if(err) reject(err);            
                resolve(res);
            });
        }
        catch(err) {
            console.log("getLatestBlock error", err)
            reject(err);
        }
    });       
}

function getBlock(client, height) {
    return new Promise(async (resolve, reject) => {
        try {
            await client.GetBlock({height: height}, (err, res) => {
                if(err) reject(err);
                resolve(res);
            });
        }
        catch(err){
            console.log("getBlock error", err);
            reject(err);
        }
    });       
}

function getTransaction(client, filter) {
    return new Promise(async (resolve, reject) => {
        try {
            await client.getTransaction({hash: Buffer.from(filter, 'hex').reverse()}, (err, res) => {
                if(err) reject(err);
                
                resolve(res);
            });
        }
        catch(err) {
            reject(err);
            console.log("getTransaction error", err);
        }
    }); 
}

function getMempoolStream(client) {
     // const txns = [];
    const emitter = new EventEmitter();
    const call = client.GetMempoolStream({});
    call.on('data', (tx) => {
        emitter.emit('newtx', tx);
    });

    call.on('end', () => {
        // console.log('stream closed');
        emitter.emit('closed');
    });

    call.on('error', (err) => {
        emitter.emit('error', err);
    });      

    return emitter;
}

module.exports = { 
    init,
    getLatestBlock,
    getBlock,
    getTransaction,
    getMempoolStream
}
