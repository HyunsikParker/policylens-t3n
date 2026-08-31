import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { readMode0600Secret, requireEnv, sanitizedError } from "./lib.js";

interface ContractReceipt {
  tenant_did: string;
  contract_name: string;
  contract_version: string;
}

function scrub(value: string, apiKey: string): string {
  return value
    .replaceAll(apiKey, "[REDACTED_API_KEY]")
    .replace(/did:t3n:[0-9a-f]{40}/gi, "did:t3n:[REDACTED_DID]")
    .replace(/z:[0-9a-f]{40}:/gi, "z:[REDACTED_TENANT]:")
    .replace(/\b[0-9a-f]{40}\b/gi, "[REDACTED_ACCOUNT]")
    .replace(/\b[A-Za-z0-9_-]{60,}\b/g, "[REDACTED_TOKEN]");
}

async function main(): Promise<void> {
  const baseUrl = requireEnv("T3N_NODE_URL");
  const apiKey = await readMode0600Secret(requireEnv("T3N_AGENT_API_KEY_FILE"));
  const contract = JSON.parse(await readFile(requireEnv("T3N_CONTRACT_RECEIPT_FILE"), "utf8")) as ContractReceipt;
  const response = await fetch(`${baseUrl}/api/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-T3N-Api-Key": apiKey },
    body: JSON.stringify({
      contract_id: contract.contract_name,
      contract_version: contract.contract_version,
      function_name: "health",
      pii_did: contract.tenant_did,
      input: {},
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const rawBody = await response.text();
  const safeBody = scrub(rawBody, apiKey);
  if (safeBody.includes(apiKey)) throw new Error("credential scrub failed");
  const receipt = {
    observed_at: new Date().toISOString(),
    request: { function_name: "health", input: {}, subject_matches_contract_tenant: true },
    response: {
      status: response.status,
      content_type: response.headers.get("content-type"),
      body_sha256: createHash("sha256").update(rawBody).digest("hex"),
      scrubbed_body: safeBody,
    },
    credential_material_in_receipt: false,
  };
  await writeFile(requireEnv("T3N_INVOKE_PROBE_FILE"), `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(`${JSON.stringify({
    status: response.status,
    contentType: receipt.response.content_type,
    bodySha256: receipt.response.body_sha256,
    scrubbedBody: safeBody.slice(0, 500),
    credentialExposed: false,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Invoke route probe failed: ${sanitizedError(error)}\n`);
  process.exitCode = 1;
});
