import assert from "node:assert/strict";
import test from "node:test";
import type { InvokeOptions } from "@terminal3/t3n-sdk";
import { PolicyLensClient, SessionPolicyLensClient } from "../src/client.js";
import type { AgentConfig } from "../src/config.js";

const config: AgentConfig = {
  baseUrl: "https://node.example.test",
  apiKey: "t3n_key_key.secret",
  contractId: "z:0123456789abcdef0123456789abcdef01234567:policy-lens",
  contractVersion: "0.1.0",
  subjectDid: "did:t3n:0123456789abcdef0123456789abcdef01234567",
  timeoutMs: 30_000,
};

const request = {
  request_id: "REQ-2026-0001",
  category: "software",
  amount_usd_cents: 125_000,
  currency: "USD",
  vendor_country: "US",
  data_classification: "internal",
  security_reviewed: false,
  business_purpose: "internal_operations",
};

const receipt = {
  request_id: "REQ-2026-0001",
  decision: "approve",
  reason_codes: ["policy_checks_passed"],
  policy_version: "2026-09-01",
  request_fingerprint: "a".repeat(64),
  audited_at_epoch_secs: 1_788_200_000,
  ledger_seq: 42,
  replayed: false,
};

test("builds the exact stateless invoke wire request", async () => {
  let captured: InvokeOptions | undefined;
  const client = new PolicyLensClient(config, async (options) => {
    captured = options;
    return receipt;
  });
  assert.deepEqual(await client.evaluate(request), receipt);
  assert.deepEqual(captured?.request, {
    contract_id: config.contractId,
    contract_version: "0.1.0",
    function_name: "evaluate-request",
    pii_did: config.subjectDid,
    input: request,
  });
  assert.equal(captured?.apiKey, config.apiKey);
});

test("fails closed before transport when input contains PII", async () => {
  let calls = 0;
  const client = new PolicyLensClient(config, async () => {
    calls += 1;
    return receipt;
  });
  await assert.rejects(client.evaluate({ ...request, employee_name: "Alice" }), /unsupported fields/);
  assert.equal(calls, 0);
});

test("validates the contract response instead of trusting it", async () => {
  const client = new PolicyLensClient(config, async () => ({ ...receipt, request_fingerprint: "bad" }));
  await assert.rejects(client.evaluate(request), /fingerprint is invalid/);
});

test("session adapter preserves strict validation and the contract function boundary", async () => {
  const calls: Array<{ functionName: string; input: unknown }> = [];
  const client = new SessionPolicyLensClient(async (functionName, input) => {
    calls.push({ functionName, input });
    return receipt;
  });
  assert.deepEqual(await client.evaluate(request), receipt);
  assert.deepEqual(calls, [{ functionName: "evaluate-request", input: request }]);
});

test("session adapter rejects PII before a funded contract call", async () => {
  let calls = 0;
  const client = new SessionPolicyLensClient(async () => {
    calls += 1;
    return receipt;
  });
  await assert.rejects(client.evaluate({ ...request, requester_email: "private@example.invalid" }), /unsupported fields/);
  assert.equal(calls, 0);
});
