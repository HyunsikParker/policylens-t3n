#![warn(clippy::style, missing_debug_implementations)]
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

use alloc::{string::String, vec::Vec};
use serde::{Deserialize, Serialize};

pub mod policy;

pub const CONTRACT_VERSION: &str = "0.1.0";
pub const CONTRACT_TAIL: &str = "policy-lens";

wit_bindgen::generate!({
    world: "policy-lens",
    path: "wit",
    additional_derives: [serde::Deserialize, serde::Serialize],
    generate_all,
});

struct Component;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GetDecisionRequest {
    request_id: String,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    contract: &'static str,
    version: &'static str,
    storage: &'static str,
    outbound_network: bool,
    accepted_functions: [&'static str; 3],
}

fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    serde_json::to_vec(value).map_err(|error| alloc::format!("cannot encode response: {error}"))
}

fn tenant_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(target_arch = "wasm32")]
fn tenant_map(tail: &str) -> String {
    let tenant_did = host::tenant::tenant_context::tenant_did();
    alloc::format!("z:{}:{tail}", tenant_hex(&tenant_did))
}

#[cfg(target_arch = "wasm32")]
fn evaluate_request(input: &[u8]) -> Result<Vec<u8>, String> {
    use host::interfaces::{kv_store, logging};

    let request = policy::parse_request(input)?;
    let digest = policy::request_digest(&request)?;
    let audit_map = tenant_map("policy-lens-audit");

    if let Some(existing) = kv_store::get(&audit_map, request.request_id.as_bytes())
        .map_err(|error| alloc::format!("audit read failed: {error}"))?
    {
        let mut receipt: policy::DecisionReceipt = serde_json::from_slice(&existing)
            .map_err(|error| alloc::format!("stored audit receipt is invalid: {error}"))?;
        if receipt.request_fingerprint != policy::hex_digest(&digest) {
            return Err("request_id already exists with a different payload".into());
        }
        receipt.replayed = true;
        return encode(&receipt);
    }

    let policy_map = tenant_map("policy-lens-policy");
    let policy_bytes = kv_store::get(&policy_map, b"active")
        .map_err(|error| alloc::format!("policy read failed: {error}"))?
        .ok_or("active policy is not configured")?;
    let active_policy = policy::parse_policy(&policy_bytes)?;

    let receipt = policy::evaluate(
        &request,
        &active_policy,
        host::tenant::tenant_context::cluster_timestamp_secs(),
        host::tenant::tenant_context::seq_no(),
    )?;
    let encoded = encode(&receipt)?;

    kv_store::set_claims_digest(&digest)
        .map_err(|error| alloc::format!("claims digest failed: {error}"))?;
    kv_store::put(&audit_map, request.request_id.as_bytes(), &encoded)
        .map_err(|error| alloc::format!("audit write failed: {error}"))?;
    let _ = logging::info(&alloc::format!(
        "PolicyLens decision={} request_id={}",
        receipt.decision.as_str(),
        receipt.request_id
    ));
    Ok(encoded)
}

#[cfg(target_arch = "wasm32")]
fn get_decision(input: &[u8]) -> Result<Vec<u8>, String> {
    use host::interfaces::kv_store;

    let query: GetDecisionRequest = serde_json::from_slice(input)
        .map_err(|error| alloc::format!("invalid get-decision schema: {error}"))?;
    if !(3..=64).contains(&query.request_id.len())
        || !query
            .request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("request_id must be 3-64 ASCII letters, digits, '-' or '_'".into());
    }
    kv_store::get(&tenant_map("policy-lens-audit"), query.request_id.as_bytes())
        .map_err(|error| alloc::format!("audit read failed: {error}"))?
        .ok_or_else(|| String::from("decision not found"))
}

fn health() -> Result<Vec<u8>, String> {
    encode(&HealthResponse {
        status: "ok",
        contract: CONTRACT_TAIL,
        version: CONTRACT_VERSION,
        storage: "tenant_private_kv",
        outbound_network: false,
        accepted_functions: ["evaluate-request", "get-decision", "health"],
    })
}

#[cfg(target_arch = "wasm32")]
impl exports::z::policy_lens::contracts::Guest for Component {
    fn evaluate_request(
        req: exports::z::policy_lens::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        evaluate_request(&req.input.ok_or("evaluate-request: missing input")?)
    }

    fn get_decision(
        req: exports::z::policy_lens::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        get_decision(&req.input.ok_or("get-decision: missing input")?)
    }

    fn health(
        _req: exports::z::policy_lens::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        health()
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_declares_no_network_access() {
        let value: serde_json::Value = serde_json::from_slice(&health().unwrap()).unwrap();
        assert_eq!(value["outbound_network"], false);
        assert_eq!(value["version"], CONTRACT_VERSION);
    }

    #[test]
    fn contract_version_is_semver() {
        let parts: Vec<&str> = CONTRACT_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3);
        assert!(parts.iter().all(|part| part.parse::<u32>().is_ok()));
    }
}
