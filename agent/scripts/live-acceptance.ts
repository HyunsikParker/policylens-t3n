import { readFile, writeFile } from "node:fs/promises";
import { PolicyLensClient } from "../src/client.js";
import type { AgentConfig } from "../src/config.js";
import type { DecisionReceipt, ProcurementRequest } from "../src/domain.js";
import { readMode0600Secret, requireEnv, sanitizedError } from "./lib.js";

interface ContractReceipt {
  tenant_did: string;
  contract_name: string;
  contract_version: string;
}

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
  const contract = await readJson(requireEnv("T3N_CONTRACT_RECEIPT_FILE")) as ContractReceipt;
  const config: AgentConfig = {
    baseUrl: requireEnv("T3N_NODE_URL"),
    apiKey: await readMode0600Secret(requireEnv("T3N_AGENT_API_KEY_FILE")),
    contractId: contract.contract_name,
    contractVersion: contract.contract_version,
    subjectDid: contract.tenant_did,
    timeoutMs: 60_000,
  };
  const client = new PolicyLensClient(config);
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

  let piiRejectedLocally = false;
  try {
    await client.evaluate(await readJson(`${fixtureRoot}/reject-pii.json`));
  } catch (error: unknown) {
    piiRejectedLocally = /unsupported fields: requester_email/.test(
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!piiRejectedLocally) throw new Error("PII fixture was not rejected before transport");

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

  const receipt = {
    observed_at: new Date().toISOString(),
    network: "sandbox",
    contract: "policy-lens",
    contract_version: contract.contract_version,
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
    credential_material_in_receipt: false,
  };
  await writeFile(requireEnv("T3N_LIVE_RECEIPT_FILE"), `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(`${JSON.stringify({
    live: true,
    health: health.status,
    outboundNetwork: health.outbound_network,
    acceptedFunctions: health.accepted_functions.length,
    approve: approve.decision,
    replayed: replay.replayed,
    collisionRejected,
    deny: deny.decision,
    piiRejectedBeforeTransport: piiRejectedLocally,
    heldOutReview: review.decision,
    storedReviewMatches: true,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Live acceptance failed: ${sanitizedError(error)}\n`);
  process.exitCode = 1;
});
