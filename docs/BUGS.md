# T3N integration findings

These issues were reproduced against T3N Sandbox on August 31, 2026. No credential or tenant identifier is included here.

## 1. Newly provisioned agent cannot use its valid API key because it has zero credits

### Reproduction

1. Authenticate a funded developer DID.
2. Create an organization-owned, private-card agent.
3. Apply an exact PolicyLens grant for `evaluate-request`, `get-decision`, and `health`, with no allowed hosts.
4. Confirm through `whoami` and `delegation.check` that the API key resolves to the agent and the grant is authorized with no missing conditions.
5. Call `POST /api/invoke` with the agent key and the `health` function.

### Observed

The server returns HTTP 403 `InsufficientCredit`: required 10,000 credits, available 0. The funded developer DID retained more than 18,000 credits. The public SDK and CLI expose usage history but no developer-to-agent credit-transfer operation.

### Expected

The claim/provisioning flow should either fund a newly created agent enough to perform its granted function, expose an authorized transfer/funding operation, or clearly document the required funding step.

### PolicyLens handling

The valid agent and minimum grant are retained, but the live acceptance uses the funded developer session against the same tenant contract. The agent-key 403 is not presented as a successful stateless invocation.

## 2. SDK 5.3.0 rejects the current sandbox signed manifest schema

### Reproduction

Authenticate with `@terminal3/t3n-sdk` 5.3.0 and request the signed sandbox manifest.

### Observed

The SDK rejects the otherwise signed manifest because the server payload omits `rtmr1_allowlist`, a field expected by that client version. No contract call is attempted.

### Compatibility check

SDK versions 5.2.0, 5.1.0, and 4.30.0 were checked against the same public manifest and accepted its signature without unsafe trust. PolicyLens pins 5.2.0 and validates the signed trust anchor before authentication.

### Expected

Client and server manifest schemas should be deployed compatibly, or the new field should be optional while the server rollout is incomplete.

## 3. macOS mixed Rust toolchains can report a false missing-target error

If `rustup run stable cargo` launches Cargo but `PATH` resolves `rustc` to Homebrew, a `wasm32-wasip2` build can fail with “can't find crate for core” even when `rustup target list` shows the target installed. `scripts/verify.sh` binds Cargo, rustc, and the dynamic-library directory to the same rustup toolchain.
