import { readFile, writeFile } from "node:fs/promises";
import { discoverWhoami } from "@terminal3/t3n-sdk";
import { authenticateFromFile, readMode0600Secret, requireEnv, sanitizedError } from "./lib.js";

interface ContractReceipt {
  tenant_did: string;
  contract_name: string;
}

async function main(): Promise<void> {
  const apiKey = await readMode0600Secret(requireEnv("T3N_AGENT_API_KEY_FILE"));
  const baseUrl = requireEnv("T3N_NODE_URL");
  const whoami = await discoverWhoami({ baseUrl, apiKey });
  const { client, did: tenantDid } = await authenticateFromFile(requireEnv("T3N_DEVELOPER_KEY_FILE"));
  const contract = JSON.parse(
    await readFile(requireEnv("T3N_CONTRACT_RECEIPT_FILE"), "utf8"),
  ) as ContractReceipt;
  if (contract.tenant_did !== tenantDid) throw new Error("contract receipt tenant does not match authenticated tenant");

  const result = await client.updateAgentAuth(whoami.did, {
    scriptName: contract.contract_name,
    versionReq: "=0.1.0",
    functions: ["evaluate-request", "get-decision", "health"],
    allowedHosts: [],
  });
  const receipt = {
    granted_at: new Date().toISOString(),
    tenant_did: tenantDid,
    agent_did: whoami.did,
    contract_name: contract.contract_name,
    functions: ["evaluate-request", "get-decision", "health"],
    allowed_hosts: [],
    preserved_rows: result.preservedRows,
  };
  await writeFile(requireEnv("T3N_GRANT_RECEIPT_FILE"), `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify({
    granted: true,
    contract: "policy-lens",
    functions: receipt.functions,
    allowedHosts: receipt.allowed_hosts,
    preservedRows: receipt.preserved_rows,
    receiptMode: "0600",
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Agent grant failed: ${sanitizedError(error)}\n`);
  process.exitCode = 1;
});
