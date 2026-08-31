# PolicyLens runbook

## Fresh sandbox deployment

1. Verify local code with `./scripts/verify.sh`.
2. Authenticate with `npm run quickstart --prefix agent`; require DID continuity and a signature-verified manifest.
3. Build the component and record its SHA-256 before upload.
4. Run `setup:contract` exactly once for a fresh tenant. It registers `policy-lens@0.1.0`, creates the private policy and audit maps, and seeds the active policy.
5. Provision one private-card organization agent with `provision` and immediately move the returned key into a mode-0600 file.
6. Apply `grant`; require exactly `evaluate-request`, `get-decision`, and `health`, with an empty host allowlist.
7. Reconcile and inspect receipts before executing fixtures. Never create duplicate contracts, maps, organizations, or agents to recover from a receipt-writing failure.

Every secret environment variable in `.env.example` is a file path, not the secret itself.

Provisioning, contract setup, and grant scripts print only sanitized summaries. Do not redirect verbose SDK diagnostics or private receipt files into shared logs or screen recordings.

## Acceptance

Run local tests first. On a disposable tenant with fresh request IDs, call `health`, then approve, replay, changed-payload collision, deny, local PII rejection, held-out review, and stored-receipt readback. Measure balance before and after.

The repository's fixed fixture IDs were consumed by the August 31, 2026 sandbox acceptance. Treat the retained public evidence as immutable; do not rerun those first-write assertions.

## Policy change

1. Prepare a new policy version and review it outside T3N.
2. Validate that categories and countries satisfy the strict schema.
3. Record the current policy and intended effective time.
4. Update only the `active` policy-map key through an authenticated tenant session.
5. Execute a fresh holdout suite with new request IDs.
6. Retain the old policy and change receipt according to the organization's audit policy.

## Incident response

- Suspected key exposure: stop callers, revoke the agent grant, rotate the affected credential, then reissue the minimum grant.
- Unexpected decision: preserve request ID, fingerprint, policy version, and ledger sequence; do not resend a changed payload under the same ID.
- Contract issue: disable the contract before changing state; publish a new semantic version and verify its component hash.
- Credit exhaustion: stop retries. Confirm caller balance and the platform minimum before any protected call.
- Receipt failure after a server write: reconcile by canonical name and read existing state; never blindly recreate resources.

## Revocation and retirement

Remove the PolicyLens grant from the agent, disable the contract, export approved audit evidence, and rotate or destroy credentials according to the receiving organization's policy. Unregister and delete maps only after retention requirements are satisfied; deletion is intentionally not automated by this repository.

## Full handover package

Transfer the public repository, exact component hash, contract version, policy schema, map names, sanitized deployment evidence, and this runbook. Transfer or rotate credentials separately. The recipient must independently authenticate, inspect map ACLs and grants, and run a fresh-ID acceptance suite before taking ownership.
