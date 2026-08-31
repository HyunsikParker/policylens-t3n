import { writeFile } from "node:fs/promises";
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticateFromFile, readMode0600Secret, requireEnv, sanitizedError } from "./lib.js";

interface HealthResponse {
  status: string;
  storage: string;
  outbound_network: boolean;
  accepted_functions: string[];
}

function isExpectedHealth(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const health = value as Partial<HealthResponse>;
  return health.status === "ok"
    && health.storage === "tenant_private_kv"
    && health.outbound_network === false
    && Array.isArray(health.accepted_functions)
    && health.accepted_functions.length === 3
    && health.accepted_functions.every((name) => typeof name === "string");
}

async function main(): Promise<void> {
  const { client, did } = await authenticateFromFile(requireEnv("T3N_DEVELOPER_KEY_FILE"));
  const expectedDid = await readMode0600Secret(requireEnv("T3N_EXPECTED_DID_FILE"));
  if (did !== expectedDid) throw new Error("Authenticated DID does not match the issuance receipt");

  const before = await client.getUsage({ limit: 1 });
  const tenant = new TenantClient({ t3n: client, baseUrl: getNodeUrl(), tenantDid: did });
  const health = await tenant.contracts.execute("policy-lens", {
    version: "0.1.0",
    functionName: "health",
    input: {},
  });
  if (!isExpectedHealth(health)) throw new Error("Live health response violated the minimum-authority contract");
  const after = await client.getUsage({ limit: 1 });

  const receipt = {
    observed_at: new Date().toISOString(),
    network: "sandbox",
    authentication: "developer_session",
    did_matches_issuance: true,
    request: { contract: "policy-lens", version: "0.1.0", function: "health", input: {} },
    health,
    balance_before_base_units: before.balance,
    balance_after_base_units: after.balance,
    credential_material_in_receipt: false,
  };
  await writeFile(requireEnv("T3N_SESSION_HEALTH_RECEIPT_FILE"), `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(`${JSON.stringify({
    live: true,
    authentication: "developer_session",
    didMatchesIssuance: true,
    health: health.status,
    storage: health.storage,
    outboundNetwork: health.outbound_network,
    acceptedFunctions: health.accepted_functions.length,
    balanceBeforeBaseUnits: before.balance,
    balanceAfterBaseUnits: after.balance,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Session health probe failed: ${sanitizedError(error)}\n`);
  process.exitCode = 1;
});
