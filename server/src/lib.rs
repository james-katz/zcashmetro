use neon::prelude::*;
use zcash_primitives::transaction::Transaction;
use zcash_primitives::consensus::BranchId;
use hex::decode;
use serde::Serialize;
// use serde_json::;

fn hello(mut cx: FunctionContext) -> JsResult<JsString> {
    Ok(cx.string("hello node"))
}

#[derive(Serialize)]
struct TransactionData {
    // Define the fields you want to serialize to JSON
    txid: String,
}

pub fn get_transaction_data(txdata: &str) -> Result<Transaction, Box<dyn std::error::Error>> {
    let tx_bytes = decode(txdata)?;
    let transaction = Transaction::read(&tx_bytes[..], BranchId::Nu5)?;
    // println!("{:?}", transaction);
    Ok(transaction)
}

fn get_transaction_data_js(mut cx: FunctionContext) -> JsResult<JsString> {
    let txdata = cx.argument::<JsString>(0)?.value(&mut cx);
    match get_transaction_data(&txdata) {
        Ok(transaction) => {
            // Serialize transaction to JSON
            let tx_json = serde_json::to_string(&TransactionData {
                txid: format!("{:?}", transaction.txid().to_string()), // txid field
            }).unwrap();
            Ok(cx.string(tx_json))
        },
        Err(e) => cx.throw_error(format!("Failed to decode transaction: {}", e)),
    }
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("hello", hello)?;
    cx.export_function("getTransactionData", get_transaction_data_js)?;
    Ok(())
}
