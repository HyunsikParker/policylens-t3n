import { readFile, writeFile } from "node:fs/promises";
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { SessionPolicyLensClient } from "../src/client.js";
import type { DecisionReceipt, ProcurementRequest } from "../src/domain.js";
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
  let contractCalls = 0;
  const client = new SessionPolicyLensClient(async (functionName, input) => {
    contractCalls += 1;
    if (contractCalls > 7) throw new Error("live acceptance exceeded the seven-call cap");
    return tenant.contracts.execute("policy-lens", { version: "0.1.0", functionName, input });
  });

  const fixtureRoot = requireEnv("POLICYLENS_FIXTURE_DIR");
  const health = await client.health();
  if (health.outbound_network !== false || health.accepted_functions.length !== 3) {
    throw new Error("live health response violated the minimum-authority contract");
  }

  const approveInput = await readJson(`${fixtureRoot}/approve.json`);
  const approve = await client.evaluate(approveInput);
  if (approve.decision !== "approve" || approve.replayed) throw new Error("approve fixture failed");
  const replay = await client.evaluate(approveInput);
  if (!replay.replayed || !sameStoredDecision(approve, replay)) throw new Error("idempotent replay failed");

  let collisionRejected = false;
  try {
    await client.evaluate({
      ...(approveInput as ProcurementRequest),
      amount_usd_cents: (approveInput as ProcurementRequest).amount_usd_cents + 1,
    });
  } catch (error: unknown) {
    collisionRejected = /different payload|already exists/i.test(error instanceof Error ? error.message : String(error));
  }
  if (!collisionRejected) throw new Error("request-id collision was not rejected");

  const deny = await client.evaluate(await readJson(`${fixtureRoot}/deny.json`));
  if (deny.decision !== "deny" || !deny.reason_codes.includes("category_not_allowed")) {
    throw new Error("deny fixture failed");
  }

  const callsBeforePii = contractCalls;
  let piiRejectedLocally = false;
  try {
    await client.evaluate(await readJson(`${fixtureRoot}/reject-pii.json`));
  } catch (error: unknown) {
    piiRejectedLocally = /unsupported fields: requester_email/.test(
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!piiRejectedLocally || contractCalls !== callsBeforePii) {
    throw new Error("PII fixture was not rejected before transport");
  }

  const review = await client.evaluate(await readJson(`${fixtureRoot}/review.json`));
  if (
    review.decision !== "human_review"
    || !review.reason_codes.includes("amount_above_auto_approve_limit")
    || !review.reason_codes.includes("security_review_required")
  ) {
    throw new Error("held-out review fixture failed");
  }
  const storedReview = await client.getDecision(review.request_id);
  if (!sameStoredDecision(review, storedReview)) throw new Error("stored review receipt does not match");
  if (contractCalls !== 7) throw new Error(`expected exactly seven contract calls, observed ${contractCalls}`);

  const after = await session.getUsage({ limit: 1 });
  const consumedBaseUnits = before.balance.available - after.balance.available;
  if (consumedBaseUnits < 0 || consumedBaseUnits > 100_000_000) {
    throw new Error(`live acceptance exceeded the 100-credit cap: ${consumedBaseUnits} base units`);
  }

  const receipt = {
    observed_at: new Date().toISOString(),
    network: "sandbox",
    authentication: "developer_session",
    did_matches_issuance: true,
    contract: "policy-lens",
    contract_version: "0.1.0",
    contract_calls: contractCalls,
    health: {
      status: health.status,
      storage: health.storage,
      outbound_network: health.outbound_network,
      accepted_functions: health.accepted_functions,
    },
    cases: {
      approve,
      replay,
      collision_rejected: collisionRejected,
      deny,
      pii_rejected_before_transport: piiRejectedLocally,
      held_out_review: review,
      stored_review_matches: true,
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
    contractCalls,
    health: health.status,
    outboundNetwork: health.outbound_network,
    approve: approve.decision,
    replayed: replay.replayed,
    collisionRejected,
    deny: deny.decision,
    piiRejectedBeforeTransport: piiRejectedLocally,
    heldOutReview: review.decision,
    storedReviewMatches: true,
    consumedBaseUnits,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Session acceptance failed: ${sanitizedError(error)}\n`);
  process.exitCode = 1;
});
