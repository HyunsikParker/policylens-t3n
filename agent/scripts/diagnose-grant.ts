import { readFile, writeFile } from "node:fs/promises";
import { discoverCheckDelegation, discoverWhoami } from "@terminal3/t3n-sdk";
import { readMode0600Secret, requireEnv, sanitizedError } from "./lib.js";

interface ContractReceipt {
  tenant_did: string;
  contract_name: string;
}

interface AgentReceipt {
  organisation_did: string;
  agent_did: string;
}

async function main(): Promise<void> {
  const baseUrl = requireEnv("T3N_NODE_URL");
  const apiKey = await readMode0600Secret(requireEnv("T3N_AGENT_API_KEY_FILE"));
  const contract = JSON.parse(await readFile(requireEnv("T3N_CONTRACT_RECEIPT_FILE"), "utf8")) as ContractReceipt;
  const agent = JSON.parse(await readFile(requireEnv("T3N_PROVISION_RECEIPT_FILE"), "utf8")) as AgentReceipt;
  const transport = { baseUrl, apiKey, timeoutMs: 30_000 };
  const whoami = await discoverWhoami(transport);
  if (whoami.did !== agent.agent_did) throw new Error("agent key did not resolve to the provisioned agent");
  const required = {
    contract: contract.contract_name,
    functions: ["evaluate-request", "get-decision", "health"],
    scopes: [] as string[],
  };
  const [memberSubject, organisationSubject] = await Promise.all([
    discoverCheckDelegation(transport, { ...required, pii_did: contract.tenant_did }),
    discoverCheckDelegation(transport, { ...required, pii_did: agent.organisation_did }),
  ]);
  const receipt = {
    observed_at: new Date().toISOString(),
    whoami: {
      did_matches_provisioning: true,
      owner_matches_organisation: whoami.owner === agent.organisation_did,
      organisation_membership_present: whoami.organisations.includes(agent.organisation_did),
      organisation_count: whoami.organisations.length,
    },
    member_subject: memberSubject,
    organisation_subject: organisationSubject,
    credential_material_in_receipt: false,
  };
  await writeFile(requireEnv("T3N_GRANT_DIAGNOSTIC_FILE"), `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(`${JSON.stringify({
    whoamiDidMatches: true,
    ownerMatchesOrganisation: receipt.whoami.owner_matches_organisation,
    organisationMembershipPresent: receipt.whoami.organisation_membership_present,
    memberSubject: {
      authorised: memberSubject.authorised,
      disclosed: memberSubject.disclosed,
      satisfied: memberSubject.satisfied.map((item) => item.grant),
      missing: memberSubject.missing.map((item) => item.grant),
    },
    organisationSubject: {
      authorised: organisationSubject.authorised,
      disclosed: organisationSubject.disclosed,
      satisfied: organisationSubject.satisfied.map((item) => item.grant),
      missing: organisationSubject.missing.map((item) => item.grant),
    },
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Grant diagnostic failed: ${sanitizedError(error)}\n`);
  process.exitCode = 1;
});
