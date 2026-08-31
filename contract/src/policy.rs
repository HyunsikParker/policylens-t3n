use alloc::{string::String, vec::Vec};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DataClassification {
    Public,
    Internal,
    Confidential,
    Restricted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BusinessPurpose {
    CustomerDelivery,
    InternalOperations,
    Research,
    Compliance,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProcurementRequest {
    pub request_id: String,
    pub category: String,
    pub amount_usd_cents: u64,
    pub currency: String,
    pub vendor_country: String,
    pub data_classification: DataClassification,
    pub security_reviewed: bool,
    pub business_purpose: BusinessPurpose,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub version: String,
    pub max_auto_approve_usd_cents: u64,
    pub allowed_categories: Vec<String>,
    pub blocked_countries: Vec<String>,
    pub classifications_requiring_security_review: Vec<DataClassification>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Approve,
    HumanReview,
    Deny,
}

impl Decision {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Approve => "approve",
            Self::HumanReview => "human_review",
            Self::Deny => "deny",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionReceipt {
    pub request_id: String,
    pub decision: Decision,
    pub reason_codes: Vec<String>,
    pub policy_version: String,
    pub request_fingerprint: String,
    pub audited_at_epoch_secs: u64,
    pub ledger_seq: u64,
    pub replayed: bool,
}

pub fn parse_request(input: &[u8]) -> Result<ProcurementRequest, String> {
    let request: ProcurementRequest = serde_json::from_slice(input)
        .map_err(|error| alloc::format!("invalid request schema: {error}"))?;
    validate_request(&request)?;
    Ok(request)
}

pub fn parse_policy(input: &[u8]) -> Result<Policy, String> {
    let policy: Policy = serde_json::from_slice(input)
        .map_err(|error| alloc::format!("invalid policy schema: {error}"))?;
    validate_policy(&policy)?;
    Ok(policy)
}

pub fn validate_request(request: &ProcurementRequest) -> Result<(), String> {
    if !(3..=64).contains(&request.request_id.len())
        || !request
            .request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("request_id must be 3-64 ASCII letters, digits, '-' or '_'".into());
    }
    if !(2..=48).contains(&request.category.len())
        || !request
            .category
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err("category must be 2-48 lowercase ASCII letters, digits or '_'".into());
    }
    if request.amount_usd_cents == 0 || request.amount_usd_cents > 1_000_000_000 {
        return Err("amount_usd_cents must be between 1 and 1000000000".into());
    }
    if request.currency != "USD" {
        return Err("currency must be USD".into());
    }
    if request.vendor_country.len() != 2
        || !request.vendor_country.bytes().all(|byte| byte.is_ascii_uppercase())
    {
        return Err("vendor_country must be a two-letter uppercase country code".into());
    }
    Ok(())
}

pub fn validate_policy(policy: &Policy) -> Result<(), String> {
    if policy.version.is_empty() || policy.version.len() > 32 {
        return Err("policy version must contain 1-32 bytes".into());
    }
    if policy.max_auto_approve_usd_cents == 0 {
        return Err("max_auto_approve_usd_cents must be positive".into());
    }
    if policy.allowed_categories.is_empty() {
        return Err("allowed_categories must not be empty".into());
    }
    for category in &policy.allowed_categories {
        if !(2..=48).contains(&category.len())
            || !category
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        {
            return Err("policy contains an invalid category".into());
        }
    }
    for country in &policy.blocked_countries {
        if country.len() != 2 || !country.bytes().all(|byte| byte.is_ascii_uppercase()) {
            return Err("policy contains an invalid country code".into());
        }
    }
    Ok(())
}

pub fn request_digest(request: &ProcurementRequest) -> Result<[u8; 32], String> {
    let canonical = serde_json::to_vec(request)
        .map_err(|error| alloc::format!("cannot canonicalize request: {error}"))?;
    Ok(Sha256::digest(canonical).into())
}

pub fn hex_digest(digest: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(64);
    for byte in digest {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

pub fn evaluate(
    request: &ProcurementRequest,
    policy: &Policy,
    audited_at_epoch_secs: u64,
    ledger_seq: u64,
) -> Result<DecisionReceipt, String> {
    validate_request(request)?;
    validate_policy(policy)?;

    let mut deny_reasons = Vec::new();
    let mut review_reasons = Vec::new();

    if policy.blocked_countries.contains(&request.vendor_country) {
        deny_reasons.push(String::from("vendor_country_blocked"));
    }
    if !policy.allowed_categories.contains(&request.category) {
        deny_reasons.push(String::from("category_not_allowed"));
    }
    if request.amount_usd_cents > policy.max_auto_approve_usd_cents {
        review_reasons.push(String::from("amount_above_auto_approve_limit"));
    }
    if request.data_classification == DataClassification::Restricted {
        review_reasons.push(String::from("restricted_data"));
    }
    if policy
        .classifications_requiring_security_review
        .contains(&request.data_classification)
        && !request.security_reviewed
    {
        review_reasons.push(String::from("security_review_required"));
    }

    let (decision, mut reason_codes) = if !deny_reasons.is_empty() {
        (Decision::Deny, deny_reasons)
    } else if !review_reasons.is_empty() {
        (Decision::HumanReview, review_reasons)
    } else {
        (Decision::Approve, alloc::vec![String::from("policy_checks_passed")])
    };
    reason_codes.sort();
    reason_codes.dedup();

    let digest = request_digest(request)?;
    Ok(DecisionReceipt {
        request_id: request.request_id.clone(),
        decision,
        reason_codes,
        policy_version: policy.version.clone(),
        request_fingerprint: hex_digest(&digest),
        audited_at_epoch_secs,
        ledger_seq,
        replayed: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> Policy {
        Policy {
            version: "2026-09-01".into(),
            max_auto_approve_usd_cents: 250_000,
            allowed_categories: alloc::vec!["cloud_services".into(), "software".into()],
            blocked_countries: alloc::vec!["KP".into()],
            classifications_requiring_security_review: alloc::vec![
                DataClassification::Confidential,
                DataClassification::Restricted,
            ],
        }
    }

    fn request() -> ProcurementRequest {
        ProcurementRequest {
            request_id: "REQ-2026-0001".into(),
            category: "software".into(),
            amount_usd_cents: 125_000,
            currency: "USD".into(),
            vendor_country: "US".into(),
            data_classification: DataClassification::Internal,
            security_reviewed: false,
            business_purpose: BusinessPurpose::InternalOperations,
        }
    }

    #[test]
    fn approves_request_that_passes_policy() {
        let receipt = evaluate(&request(), &policy(), 100, 7).unwrap();
        assert_eq!(receipt.decision, Decision::Approve);
        assert_eq!(receipt.reason_codes, alloc::vec!["policy_checks_passed"]);
        assert_eq!(receipt.request_fingerprint.len(), 64);
    }

    #[test]
    fn routes_high_value_request_to_human_review() {
        let mut request = request();
        request.amount_usd_cents = 250_001;
        let receipt = evaluate(&request, &policy(), 100, 7).unwrap();
        assert_eq!(receipt.decision, Decision::HumanReview);
        assert_eq!(receipt.reason_codes, alloc::vec!["amount_above_auto_approve_limit"]);
    }

    #[test]
    fn routes_unreviewed_confidential_request_to_human_review() {
        let mut request = request();
        request.data_classification = DataClassification::Confidential;
        let receipt = evaluate(&request, &policy(), 100, 7).unwrap();
        assert_eq!(receipt.decision, Decision::HumanReview);
        assert_eq!(receipt.reason_codes, alloc::vec!["security_review_required"]);
    }

    #[test]
    fn denies_blocked_country_even_when_review_is_also_required() {
        let mut request = request();
        request.vendor_country = "KP".into();
        request.amount_usd_cents = 300_000;
        let receipt = evaluate(&request, &policy(), 100, 7).unwrap();
        assert_eq!(receipt.decision, Decision::Deny);
        assert_eq!(receipt.reason_codes, alloc::vec!["vendor_country_blocked"]);
    }

    #[test]
    fn rejects_unknown_pii_field() {
        let input = br#"{
          "request_id":"REQ-2026-0001",
          "category":"software",
          "amount_usd_cents":125000,
          "currency":"USD",
          "vendor_country":"US",
          "data_classification":"internal",
          "security_reviewed":false,
          "business_purpose":"internal_operations",
          "requester_email":"person@example.com"
        }"#;
        let error = parse_request(input).unwrap_err();
        assert!(error.contains("unknown field"));
    }

    #[test]
    fn fingerprint_is_stable_and_payload_sensitive() {
        let first = request_digest(&request()).unwrap();
        assert_eq!(first, request_digest(&request()).unwrap());
        let mut changed = request();
        changed.amount_usd_cents += 1;
        assert_ne!(first, request_digest(&changed).unwrap());
    }
}
