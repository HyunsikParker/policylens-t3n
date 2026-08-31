import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticateFromFile, requireEnv, sanitizedError } from "./lib.js";

const contractVersion = "0.1.0";
const contractTail = "policy-lens";

async function main(): Promise<void> {
  const { client, did: tenantDid } = await authenticateFromFile(requireEnv("T3N_DEVELOPER_KEY_FILE"));
  const tenant = new TenantClient({ t3n: client, baseUrl: getNodeUrl(), tenantDid });
  const wasm = await readFile(requireEnv("POLICYLENS_WASM_FILE"));
  const registered = await tenant.contracts.register({ tail: contractTail, version: contractVersion, wasm });

  for (const tail of ["policy-lens-policy", "policy-lens-audit"] as const) {
    try {
      await tenant.maps.create({
        tail,
        visibility: "private",
        writers: { only: [registered.contract_id] },
        readers: { only: [registered.contract_id] },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("already exists")) throw error;
      await tenant.maps.update(tail, {
        writers: { only: [registered.contract_id] },
        readers: { only: [registered.contract_id] },
      });
    }
  }

  const policy = JSON.parse(await readFile(requireEnv("POLICYLENS_POLICY_FILE"), "utf8")) as unknown;
  await tenant.maps.entrySet("policy-lens-policy", "active", JSON.stringify(policy));

  const receipt = {
    registered_at: new Date().toISOString(),
    network: "sandbox",
    tenant_did: tenantDid,
    contract_name: registered.name,
    contract_id: registered.contract_id,
    contract_version: contractVersion,
    wasm_sha256: createHash("sha256").update(wasm).digest("hex"),
    policy_map: tenant.canonicalName("policy-lens-policy"),
    audit_map: tenant.canonicalName("policy-lens-audit"),
  };
  const receiptFile = requireEnv("T3N_CONTRACT_RECEIPT_FILE");
  await mkdir(dirname(receiptFile), { recursive: true });
  await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(`${JSON.stringify({
    registered: true,
    network: receipt.network,
    contract: contractTail,
    version: contractVersion,
    privateMaps: 2,
    policySeeded: true,
    wasmSha256: receipt.wasm_sha256,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Contract setup failed: ${sanitizedError(error)}\n`);
  process.exitCode = 1;
});
