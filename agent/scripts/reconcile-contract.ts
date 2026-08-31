import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticateFromFile, requireEnv, sanitizedError } from "./lib.js";

const contractVersion = "0.1.0";
const contractTail = "policy-lens";

async function main(): Promise<void> {
  const { client, did: tenantDid } = await authenticateFromFile(requireEnv("T3N_DEVELOPER_KEY_FILE"));
  const tenant = new TenantClient({ t3n: client, baseUrl: getNodeUrl(), tenantDid });
  const contractName = tenant.canonicalName(contractTail);
  const inventory = await tenant.contracts.listDetailed({ limit: 100 });
  const contract = inventory.contracts.find((row) => row.name === contractName);
  if (!contract || contract.status !== "active" || contract.version !== contractVersion) {
    throw new Error("expected active PolicyLens contract version was not found");
  }

  const [policyMapStatus, auditMapStatus, storedPolicy] = await Promise.all([
    tenant.maps.getStatus("policy-lens-policy"),
    tenant.maps.getStatus("policy-lens-audit"),
    tenant.maps.entryGet("policy-lens-policy", "active"),
  ]);
  if (policyMapStatus !== "active" || auditMapStatus !== "active") {
    throw new Error("expected PolicyLens maps are not active");
  }
  if (storedPolicy === null) throw new Error("active policy entry is missing");

  const expectedPolicy = JSON.parse(await readFile(requireEnv("POLICYLENS_POLICY_FILE"), "utf8")) as unknown;
  if (JSON.stringify(JSON.parse(storedPolicy) as unknown) !== JSON.stringify(expectedPolicy)) {
    throw new Error("stored active policy does not match the frozen policy fixture");
  }
  const wasm = await readFile(requireEnv("POLICYLENS_WASM_FILE"));
  const receipt = {
    reconciled_at: new Date().toISOString(),
    network: "sandbox",
    tenant_did: tenantDid,
    contract_name: contractName,
    contract_id: null,
    contract_id_note: "The detailed inventory API omits numeric ids; no duplicate registration was attempted.",
    contract_version: contract.version,
    contract_status: contract.status,
    wasm_sha256: createHash("sha256").update(wasm).digest("hex"),
    policy_map: tenant.canonicalName("policy-lens-policy"),
    policy_map_status: policyMapStatus,
    policy_seed_matches: true,
    audit_map: tenant.canonicalName("policy-lens-audit"),
    audit_map_status: auditMapStatus,
  };
  await writeFile(requireEnv("T3N_CONTRACT_RECEIPT_FILE"), `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(`${JSON.stringify({
    reconciled: true,
    contract: contractTail,
    version: contract.version,
    status: contract.status,
    policyMapStatus,
    auditMapStatus,
    policySeedMatches: true,
    wasmSha256: receipt.wasm_sha256,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Contract reconciliation failed: ${sanitizedError(error)}\n`);
  process.exitCode = 1;
});
