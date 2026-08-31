# Security

## Supported scope

PolicyLens 0.1.0 is a sandbox reference implementation. It is not a purchasing system and must not receive payment credentials, personal data, attachments, or free-form documents.

## Controls

- strict allowlist schemas in both TypeScript and Rust;
- unknown fields rejected before transport and again inside the contract;
- no outbound-network, signing, profile, secret-store, or payment capability;
- tenant-private policy and audit maps;
- idempotent request IDs with payload-collision rejection;
- credential files required to use mode 0600;
- signature-backed T3N manifest verification with no unsafe-trust fallback;
- secrets and private receipts excluded from Git; and
- high-risk decisions stop at human review.

## Deployment cautions

Use a disposable T3N sandbox tenant. Fixture request IDs are durable audit keys. Confirm the active policy hash, WASM hash, contract version, map ACLs, agent card visibility, and grant contents before any acceptance run. Keep at least the platform's current protected-call credit floor available.

Do not publish developer keys, agent API keys, raw DIDs, organization identifiers, or private receipts. Handover credentials only through a separately approved secure channel and rotate them after receipt.

## Reporting

Report vulnerabilities through the repository's private GitHub security-advisory flow. Do not include live credentials, tenant identifiers, or personal information in an issue.
