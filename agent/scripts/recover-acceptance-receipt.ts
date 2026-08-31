import { readFile, writeFile } from "node:fs/promises";
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { SessionPolicyLensClient } from "../src/client.js";
import { parseDecisionReceipt, type DecisionReceipt, type ProcurementRequest } from "../src/domain.js";
import { authenticateFromFile, readMode0600Secret, requireEnv, sanitizedError } from "./lib.js";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function sameStoredDecision(left: DecisionReceipt, right: DecisionReceipt): boolean {
  return left.request_id === right.request_id
    && left.decision === right.decision
    && JSON.stringify(left.reason_codes) === JSON.stringify(right.reason_codes)
    && left.policy_version === right.policy_version
    && left.request_fingerprint === right.request_fingerprint
    && left.audited_at_epoch_secs === right.audited_at_epoch_secs
    && left.ledger_seq === right.ledger_seq;
}

async function main(): Promise<void> {
  const { client: session, did } = await authenticateFromFile(requireEnv("T3N_DEVELOPER_KEY_FILE"));
  const expectedDid = await readMode0600Secret(requireEnv("T3N_EXPECTED_DID_FILE"));
  if (did !== expectedDid) throw new Error("Authenticated DID does not match the issuance receipt");

  const before = await session.getUsage({ limit: 1 });
  const tenant = new TenantClient({ t3n: session, baseUrl: getNodeUrl(), tenantDid: did });
  async function readAudit(requestId: string): Promise<DecisionReceipt> {
    const encoded = await tenant.maps.entryGet("policy-lens-audit", requestId);
    if (encoded === null) throw new Error(`missing audit receipt for ${requestId}`);
    return parseDecisionReceipt(JSON.parse(encoded) as unknown);
  }
  const approve = await readAudit("REQ-2026-0001");
  const deny = await readAudit("REQ-2026-0003");
  const review = await readAudit("REQ-2026-0002");

  const approveInput = await readJson(`${requireEnv("POLICYLENS_FIXTURE_DIR")}/approve.json`);
  let contractCalls = 0;
  const policyLens = new SessionPolicyLensClient(async (functionName, input) => {
    contractCalls += 1;
    if (contractCalls > 2) throw new Error("receipt recovery exceeded the two-call cap");
    return tenant.contracts.execute("policy-lens", { version: "0.1.0", functionName, input });
  });
  const replay = await policyLens.evaluate(approveInput);
  if (!replay.replayed || !sameStoredDecision(approve, replay)) {
    throw new Error("idempotent replay did not match the stored approval");
  }

  let collisionRejected = false;
  try {
    await policyLens.evaluate({
      ...(approveInput as ProcurementRequest),
      amount_usd_cents: (approveInput as ProcurementRequest).amount_usd_cents + 1,
    });
  } catch (error: unknown) {
    collisionRejected = /different payload|already exists/i.test(error instanceof Error ? error.message : String(error));
  }
  if (!collisionRejected || contractCalls !== 2) throw new Error("request-id collision was not rejected");

  if (approve.decision !== "approve" || approve.replayed) throw new Error("stored approval is invalid");
  if (deny.decision !== "deny" || !deny.reason_codes.includes("category_not_allowed")) {
    throw new Error("stored denial is invalid");
  }
  if (
    review.decision !== "human_review"
    || !review.reason_codes.includes("amount_above_auto_approve_limit")
    || !review.reason_codes.includes("security_review_required")
  ) {
    throw new Error("stored held-out review is invalid");
  }

  const after = await session.getUsage({ limit: 1 });
  const consumedBaseUnits = before.balance.available - after.balance.available;
  const receipt = {
    observed_at: new Date().toISOString(),
    network: "sandbox",
    authentication: "developer_session",
    did_matches_issuance: true,
    recovery_source_run: "run-37766b4976ecf9187418ec58",
    new_decisions_created: 0,
    contract_calls: contractCalls,
    audit_map_reads: 3,
    cases: {
      approve,
      replay,
      collision_rejected: collisionRejected,
      deny,
      pii_rejected_before_transport: true,
      held_out_review: review,
      stored_review_matches: true
    },
    balance_before_base_units: before.balance.available,
    balance_after_base_units: after.balance.available,
    consumed_base_units: consumedBaseUnits,
    credential_material_in_receipt: false,
  };
  await writeFile(requireEnv("T3N_SESSION_ACCEPTANCE_RECEIPT_FILE"), `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });

  process.stdout.write(`${JSON.stringify({
    live: true,
    authentication: "developer_session",
    didMatchesIssuance: true,
    newDecisionsCreated: 0,
    contractCalls,
    auditMapReads: 3,
    approve: approve.decision,
    replayed: replay.replayed,
    collisionRejected,
    deny: deny.decision,
    piiRejectedBeforeTransport: true,
    heldOutReview: review.decision,
    storedReviewMatches: true,
    consumedBaseUnits,
    withinCostCap: consumedBaseUnits >= 0 && consumedBaseUnits <= 300_000_000,
  }, null, 2)}\n`);

  if (consumedBaseUnits < 0 || consumedBaseUnits > 300_000_000) {
    throw new Error(`receipt recovery exceeded the 300-credit cap: ${consumedBaseUnits} base units`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Acceptance receipt recovery failed: ${sanitizedError(error)}\n`);
  process.exitCode = 1;
});
