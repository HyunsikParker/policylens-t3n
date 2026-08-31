# Architecture

## Trust boundaries

PolicyLens separates five concerns:

1. The caller validates the exact request schema before transport.
2. T3N authenticates the caller through a signature-verified trust manifest.
3. The Rust/WASI contract evaluates deterministic policy inside the tenant execution boundary.
4. Private KV maps hold the active policy and redacted audit receipts.
5. Human operators own policy changes, high-risk approvals, credentials, and any purchasing action.

The contract has three T3N host imports: tenant context, KV store, and logging. Its remaining 14 imports are standard WASI plumbing produced by the component toolchain, not T3N business capabilities.

## Data model

`ProcurementRequest` accepts only:

- opaque `request_id`;
- category and amount in USD cents;
- two-letter vendor country;
- data classification;
- whether security review is complete; and
- a bounded business-purpose enum.

`DecisionReceipt` stores the request ID, decision, reason codes, policy version, SHA-256 request fingerprint, T3N cluster timestamp, ledger sequence, and replay flag. It does not store procurement contents or identity data.

## Decision order

Deny reasons dominate review reasons. Blocked countries and disallowed categories return `deny`. Otherwise, high amount, restricted data, or incomplete required security review returns `human_review`. Only requests with no deny or review reason return `approve`.

Reason codes are sorted and deduplicated. The policy and request both reject unknown fields. Reusing a request ID with the same canonical payload returns the original decision with `replayed: true`; reusing it with a different payload fails closed.

The idempotency guarantee assumes T3N serializes executions that mutate the same tenant map. The contract performs a read-then-write sequence because the current KV host interface does not expose compare-and-set. If same-map executions can interleave, production deployment requires a platform-level serialization guarantee or an atomic KV primitive.

## Storage and authority

- `policy-lens-policy` is a private tenant map whose `active` key holds the versioned policy.
- `policy-lens-audit` is a private tenant map keyed by opaque request ID.
- both maps are contract-scoped;
- the organization agent grant is limited to three PolicyLens functions;
- `allowed_hosts` is empty; and
- the agent card is private.

The demo contains no credentials and makes no T3N calls. It mirrors frozen fixtures so judges can inspect the decision model without access to the private tenant.
