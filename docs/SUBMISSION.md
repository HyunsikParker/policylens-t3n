# Submission walkthrough

## Project

PolicyLens — a minimum-authority T3N procurement policy agent that rejects PII, executes deterministic policy in a Rust/WASI contract, stores private idempotent receipts, and routes sensitive decisions to a human.

## Links

- Source: https://github.com/HyunsikParker/policylens-t3n
- Demo: https://hyunsikparker.github.io/policylens-t3n/
- Architecture: https://github.com/HyunsikParker/policylens-t3n/blob/main/ARCHITECTURE.md
- Runbook and handover: https://github.com/HyunsikParker/policylens-t3n/blob/main/RUNBOOK.md
- Reproducible T3N findings: https://github.com/HyunsikParker/policylens-t3n/blob/main/docs/BUGS.md

## Judge walkthrough

1. Open the demo and switch among Routine, Sensitive, and Disallowed requests.
2. Confirm that the UI labels itself as a local preview and points to live verification separately.
3. Run `./scripts/verify.sh` to execute Rust tests, Clippy, the WASI build, TypeScript checks, and the component capability audit.
4. Inspect `docs/evidence/live-verification.json` for the credential-free live receipt summary.
5. Review `SECURITY.md` and `RUNBOOK.md` for data boundaries, rotation, revocation, recovery, and full handover.

## Live result

The signed-manifest developer session verified health, approve, replay, changed-payload collision rejection, deny, PII rejection before transport, held-out human review, and stored-receipt equality. No external hosts were granted. The separate agent API-key credit limitation is disclosed in `docs/BUGS.md`.
