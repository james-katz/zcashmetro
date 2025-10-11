const grpc = require('./grpc_connector');
// const native = require('./index.node');

(async () => {
    const client = grpc.init('lwd1.zcash-infra.com:9067');  
    setInterval(async() => {
        console.log("Getting mempool ...")
        const mempool = await grpc.getMempoolTx(client, {});
        console.log("response: ", mempool);
    }, 5*1000);
    
})()

