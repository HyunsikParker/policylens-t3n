import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const key = "t3n_key_testkey.fixture-secret-only";
const contractId = `z:${"1".repeat(40)}:policy-lens`;
const subjectDid = `did:t3n:${"1".repeat(40)}`;
const validRequest = {
  request_id: "REQ-CHECK-001", category: "software", amount_usd_cents: 125000,
  currency: "USD", vendor_country: "US", data_classification: "internal",
  security_reviewed: false, business_purpose: "internal_operations",
};

async function run(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    env, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (x) => { stdout += String(x); });
  child.stderr.on("data", (x) => { stderr += String(x); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  return { code, stdout, stderr };
}

function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("T3N_")));
}

test("CLI file-only handover, offline checks and one-call transport", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "policylens-cli-"));
  const keyFile = join(dir, "agent-key");
  const requestFile = join(dir, "request.json");
  await writeFile(keyFile, key, { mode: 0o600 });
  await writeFile(requestFile, JSON.stringify(validRequest));
  let calls = 0;
  let fail = false;
  const server = createServer(async (req, res) => {
    calls++;
    assert.equal(req.headers["x-t3n-api-key"], key);
    assert.equal(req.url, "/api/invoke");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.contract_id, contractId);
    assert.equal(body.pii_did, subjectDid);
    assert.equal(body.function_name, "health");
    res.setHeader("Content-Type", "application/json");
    if (fail) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: `PRIVATE-SERVER-DATA ${key} ${subjectDid}` }));
      return;
    }
    res.end(JSON.stringify({ status: "ok", contract: "policy-lens", version: "0.1.0",
      storage: "tenant_private_kv", outbound_network: false,
      accepted_functions: ["evaluate-request", "get-decision", "health"] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const env = { ...cleanEnv(), T3N_NODE_URL: `http://127.0.0.1:${address.port}`,
    T3N_AGENT_API_KEY_FILE: keyFile, T3N_CONTRACT_ID: contractId, T3N_SUBJECT_DID: subjectDid };
  try {
    await t.test("documented key file config passes without a network call or secret output", async () => {
      const result = await run(["check-config"], env);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { valid: true, network_calls: 0, credential_source: "mode-0600 file", authenticated: false });
      assert.equal(calls, 0);
      for (const privateValue of [key, keyFile, subjectDid]) assert.ok(!result.stdout.includes(privateValue));
    });
    await t.test("request validation needs neither credentials nor a network", async () => {
      const result = await run(["validate", "--file", requestFile], cleanEnv());
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).network_calls, 0);
      assert.equal(calls, 0);
    });
    await t.test("PII fields are rejected before config and not echoed", async () => {
      await writeFile(requestFile, JSON.stringify({ ...validRequest, "person@example.invalid": "PRIVATE-DATA" }));
      const result = await run(["evaluate", "--file", requestFile], env);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /bounded procurement schema/);
      assert.ok(!result.stderr.includes("person@example.invalid"));
      assert.ok(!result.stderr.includes("PRIVATE-DATA"));
      assert.equal(calls, 0);
    });
    await t.test("malformed JSON never echoes the parser's input excerpt", async () => {
      await writeFile(requestFile, '{"secret":"PRIVATE-DATA" invalid}');
      const result = await run(["validate", "--file", requestFile], env);
      assert.equal(result.code, 1);
      assert.ok(!result.stderr.includes("PRIVATE-DATA"));
      assert.equal(calls, 0);
    });
    await t.test("raw credentials, URL credentials and unknown arguments fail before transport", async () => {
      for (const bad of [{ ...env, T3N_AGENT_API_KEY: key }, { ...env, T3N_NODE_URL: "https://PRIVATE-DATA@example.invalid" }]) {
        const result = await run(["health"], bad);
        assert.equal(result.code, 1);
        assert.ok(!result.stderr.includes(key));
        assert.ok(!result.stderr.includes("PRIVATE-DATA"));
      }
      assert.equal((await run(["health", "--unexpected"], env)).code, 1);
      assert.equal(calls, 0);
    });
    await t.test("world-readable credential files are rejected", async () => {
      const unsafe = join(dir, "unsafe-key");
      await writeFile(unsafe, key, { mode: 0o644 });
      assert.equal((await run(["check-config"], { ...env, T3N_AGENT_API_KEY_FILE: unsafe })).code, 1);
      assert.equal(calls, 0);
    });
    await t.test("health sends exactly one correctly scoped call using the key file", async () => {
      const result = await run(["health"], env);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).status, "ok");
      assert.equal(calls, 1);
      assert.ok(!result.stdout.includes(key));
    });
    await t.test("server failures are not retried and cannot echo private diagnostics", async () => {
      fail = true;
      const result = await run(["health"], env);
      assert.equal(result.code, 1);
      assert.equal(calls, 2);
      assert.match(result.stderr, /Contract call failed/);
      for (const privateValue of [key, subjectDid, "PRIVATE-SERVER-DATA"]) {
        assert.ok(!result.stderr.includes(privateValue));
      }
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
