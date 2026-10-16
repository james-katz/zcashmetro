//! Native Zcash transaction decoder for the ZcashMetro server.
//!
//! Exposes two functions to Node:
//!
//! * `decodeTransaction(buf: Buffer, heightHint: number) -> object`
//!   Preferred API. Takes raw tx bytes and returns a plain JS object.
//! * `getTransactionData(hex: string, height: string) -> string`
//!   Legacy API (JSON string), kept for the old test scripts.
//!
//! Decoding never panics across the FFI boundary: any panic inside the
//! Zcash parsing code is caught and turned into a JS exception, so a single
//! malformed transaction can never take the whole server down.

use neon::prelude::*;
use neon::types::buffer::TypedArray;
use serde::Serialize;
use std::panic::{self, AssertUnwindSafe};
use zcash_primitives::transaction::Transaction;
use zcash_protocol::consensus::{BlockHeight, BranchId, MainNetwork};

/// Height used to pick a consensus branch when the caller doesn't know one
/// (mempool transactions are reported with height 0 by lightwalletd).
const FALLBACK_HEIGHT: u32 = 2_726_400;

/// Summary of a decoded transaction. `None` means the bundle is absent.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct TransactionData {
    pub txid: String,
    pub n_transparent_vin: Option<usize>,
    pub n_transparent_vout: Option<usize>,
    pub n_sapling_spend: Option<usize>,
    pub n_sapling_output: Option<usize>,
    pub n_orchard_action: Option<usize>,
    pub n_ironwood_action: Option<usize>,
    pub n_expiry_height: Option<usize>,
}

/// Returns true if all bytes are printable ASCII (no control chars)
#[allow(dead_code)]
fn is_printable_ascii(bytes: &[u8]) -> bool {
    bytes.iter().all(|&b| (0x20..=0x7E).contains(&b))
}

/// Convert hex → ASCII if printable, otherwise None
#[allow(dead_code)]
fn try_hex_to_ascii(token: &str) -> Option<String> {
    if token.len() % 2 != 0 {
        return None;
    }
    let bytes = hex::decode(token).ok()?;
    if is_printable_ascii(&bytes) {
        Some(format!("\"{}\"", String::from_utf8_lossy(&bytes)))
    } else {
        None
    }
}

/// Process the entire string
#[allow(dead_code)]
fn decode_readable_hex(full: &str) -> String {
    full.split_whitespace()
        .map(|token| try_hex_to_ascii(token).unwrap_or_else(|| token.to_string()))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Pick a sane height for branch-id selection.
fn effective_height(height: u32) -> u32 {
    if height == 0 {
        FALLBACK_HEIGHT
    } else {
        height
    }
}

/// Parse raw transaction bytes into a [`Transaction`].
pub fn parse_transaction(bytes: &[u8], height: u32) -> Result<Transaction, String> {
    let branch = BranchId::for_height(
        &MainNetwork,
        BlockHeight::from_u32(effective_height(height)),
    );
    Transaction::read(bytes, branch).map_err(|e| e.to_string())
}

/// Decode raw transaction bytes into a [`TransactionData`] summary.
///
/// Any panic raised by the underlying parser is converted into an `Err`.
pub fn summarize(bytes: &[u8], height: u32) -> Result<TransactionData, String> {
    let result = panic::catch_unwind(AssertUnwindSafe(|| -> Result<TransactionData, String> {
        let tx = parse_transaction(bytes, height)?;

        let t = tx.transparent_bundle();
        let s = tx.sapling_bundle();
        let o = tx.orchard_bundle();
        let i = tx.ironwood_bundle();
        let expiry: u32 = tx.expiry_height().into();

        Ok(TransactionData {
            txid: tx.txid().to_string(),
            n_transparent_vin: t.map(|b| b.vin.len()),
            n_transparent_vout: t.map(|b| b.vout.len()),
            n_sapling_spend: s.map(|b| b.shielded_spends().len()),
            n_sapling_output: s.map(|b| b.shielded_outputs().len()),
            n_orchard_action: o.map(|b| b.actions().len()),
            n_ironwood_action: i.map(|b| b.actions().len()),
            n_expiry_height: Some(expiry as usize),
        })
    }));

    match result {
        Ok(r) => r,
        Err(p) => {
            let msg = p
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| p.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic".into());
            Err(format!("decoder panicked: {msg}"))
        }
    }
}

// ---------------------------------------------------------------------------
// Node bindings
// ---------------------------------------------------------------------------

fn hello(mut cx: FunctionContext) -> JsResult<JsString> {
    Ok(cx.string("hello node"))
}

fn set_opt<'a>(
    cx: &mut FunctionContext<'a>,
    obj: &Handle<'a, JsObject>,
    key: &str,
    v: Option<usize>,
) -> NeonResult<()> {
    match v {
        Some(n) => {
            let n = cx.number(n as f64);
            obj.set(cx, key, n)?;
        }
        None => {
            let n = cx.null();
            obj.set(cx, key, n)?;
        }
    }
    Ok(())
}

/// `decodeTransaction(buf: Buffer, heightHint?: number) -> object`
fn decode_transaction_js(mut cx: FunctionContext) -> JsResult<JsObject> {
    let buf = cx.argument::<JsBuffer>(0)?;
    let height = match cx.argument_opt(1) {
        Some(v) => v
            .downcast::<JsNumber, _>(&mut cx)
            .map(|n| n.value(&mut cx))
            .unwrap_or(0.0),
        None => 0.0,
    };
    let height = if height.is_finite() && height > 0.0 && height < u32::MAX as f64 {
        height as u32
    } else {
        0
    };

    // Copy out of the JS heap before running the (pure Rust) decoder.
    let bytes = buf.as_slice(&cx).to_vec();
    let data = match summarize(&bytes, height) {
        Ok(d) => d,
        Err(e) => return cx.throw_error(format!("Failed to decode transaction: {e}")),
    };

    let obj = cx.empty_object();
    let txid = cx.string(&data.txid);
    obj.set(&mut cx, "txid", txid)?;
    set_opt(&mut cx, &obj, "n_transparent_vin", data.n_transparent_vin)?;
    set_opt(&mut cx, &obj, "n_transparent_vout", data.n_transparent_vout)?;
    set_opt(&mut cx, &obj, "n_sapling_spend", data.n_sapling_spend)?;
    set_opt(&mut cx, &obj, "n_sapling_output", data.n_sapling_output)?;
    set_opt(&mut cx, &obj, "n_orchard_action", data.n_orchard_action)?;
    set_opt(&mut cx, &obj, "n_ironwood_action", data.n_ironwood_action)?;
    set_opt(&mut cx, &obj, "n_expiry_height", data.n_expiry_height)?;
    Ok(obj)
}

/// Legacy: `getTransactionData(hex: string, height?: string) -> string (JSON)`
fn get_transaction_data_js(mut cx: FunctionContext) -> JsResult<JsString> {
    let txdata = cx.argument::<JsString>(0)?.value(&mut cx);
    let height = match cx.argument_opt(1) {
        Some(v) => v
            .downcast::<JsString, _>(&mut cx)
            .map(|s| s.value(&mut cx))
            .unwrap_or_default(),
        None => String::new(),
    };
    let height: u32 = height.parse().unwrap_or(0);

    let bytes = match hex::decode(txdata.trim()) {
        Ok(b) => b,
        Err(e) => return cx.throw_error(format!("Failed to decode transaction: {e}")),
    };
    match summarize(&bytes, height) {
        Ok(data) => match serde_json::to_string(&data) {
            Ok(s) => Ok(cx.string(s)),
            Err(e) => cx.throw_error(format!("Failed to serialize transaction: {e}")),
        },
        Err(e) => cx.throw_error(format!("Failed to decode transaction: {e}")),
    }
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("hello", hello)?;
    cx.export_function("decodeTransaction", decode_transaction_js)?;
    cx.export_function("getTransactionData", get_transaction_data_js)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn garbage_is_an_error_not_a_panic() {
        assert!(summarize(&[], 0).is_err());
        assert!(summarize(&[0xff; 7], 0).is_err());
        assert!(summarize(&[0x05, 0x00, 0x00, 0x80, 0xff, 0xff], 3_000_000).is_err());
    }

    #[test]
    fn fixtures_decode() {
        // Each line of the fixture file: "<raw tx hex> <expected txid>"
        let fixtures = include_str!("../test/fixtures/txs.txt");
        let mut n = 0;
        for line in fixtures
            .lines()
            .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        {
            let mut parts = line.split_whitespace();
            let raw = hex::decode(parts.next().unwrap()).unwrap();
            let expected = parts.next().unwrap();
            let d = summarize(&raw, 0).expect("fixture must decode");
            assert_eq!(d.txid, expected);
            n += 1;
        }
        assert!(n > 0, "no fixtures found");
    }
}
