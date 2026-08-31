import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { authenticateFromFile, requireEnv, sanitizedError } from "./lib.js";

async function main(): Promise<void> {
  const developerKeyFile = requireEnv("T3N_DEVELOPER_KEY_FILE");
  const agentKeyFile = requireEnv("T3N_AGENT_API_KEY_FILE");
  const receiptFile = requireEnv("T3N_PROVISION_RECEIPT_FILE");
  await mkdir(dirname(agentKeyFile), { recursive: true });
  await mkdir(dirname(receiptFile), { recursive: true });
  const receiptHandle = await open(receiptFile, "wx", 0o600);
  let keyHandle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    keyHandle = await open(agentKeyFile, "wx", 0o600);
    const { client, did: administratorDid } = await authenticateFromFile(developerKeyFile);
    const configuredOrganisationDid = process.env.T3N_ORGANISATION_DID?.trim();
    const organisationDid = configuredOrganisationDid
      || (await client.createOrganisation("PolicyLens Demo")).toString();
    const provisioned = await client.createAgent(organisationDid, "PolicyLens", { defaultCard: true });

    await keyHandle.writeFile(`${provisioned.apiKey}\n`, { encoding: "utf8" });

    const receipt = {
      created_at: new Date().toISOString(),
      network: "sandbox",
      administrator_did: administratorDid,
      organisation_did: organisationDid,
      agent_did: provisioned.agentDid.toString(),
      key_id: provisioned.keyId,
      agent_uri: provisioned.agentUri ?? null,
      private_card_entry_id: provisioned.cardEntryId ?? null,
      agent_card_visibility: "private",
      api_key_file: agentKeyFile,
      api_key_captured: true,
    };
    await receiptHandle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8" });
    process.stdout.write(`${JSON.stringify({
      provisioned: true,
      network: receipt.network,
      agentCardVisibility: receipt.agent_card_visibility,
      apiKeyCaptured: receipt.api_key_captured,
      receiptMode: "0600",
    }, null, 2)}\n`);
  } finally {
    await Promise.all([keyHandle?.close(), receiptHandle.close()]);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Agent provisioning failed: ${sanitizedError(error)}\n`);
  process.exitCode = 1;
});
