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
    n_transparent_vin: Option<usize>,
    n_transparent_vout: Option<usize>,
    n_sapling_spend: Option<usize>,
    n_sapling_output: Option<usize>,
    n_orchard_action: Option<usize>,
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

            // Transparent spends / outputs
            let t_bundle = transaction.transparent_bundle();
            let t_spends = t_bundle.map(|t| t.vin.clone());
            let t_outputs = t_bundle.map(|t| t.vout.clone());
            let t_spend_count = t_spends.map(|t| t.len());
            let t_output_count = t_outputs.map(|t| t.len());

            // Sapling spends / outputs
            let z_bundle = transaction.sapling_bundle();
            let z_spends = z_bundle.map(|z| z.shielded_spends.clone());
            let z_outputs = z_bundle.map(|z| z.shielded_outputs.clone());
            let z_spend_count = z_spends.map(|z| z.len());
            let z_output_count = z_outputs.map(|z| z.len());

            // Orchard spends / outputs
            let o_bundle = transaction.orchard_bundle();
            let o_actions = o_bundle.map(|o| o.actions());
            let o_count = o_actions.map(|a| a.len());

            let tx_json = serde_json::to_string(&TransactionData {
                txid: format!("{:?}", transaction.txid().to_string()), // txid field
                n_transparent_vin: Some(t_spend_count).unwrap(),
                n_transparent_vout: Some(t_output_count).unwrap(),
                n_sapling_spend: Some(z_spend_count).unwrap(),
                n_sapling_output: Some(z_output_count).unwrap(),
                n_orchard_action: Some(o_count).unwrap()
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
