import { authenticateFromFile, readMode0600Secret, requireEnv, sanitizedError } from "./lib.js";

async function main(): Promise<void> {
  const { client, did } = await authenticateFromFile(requireEnv("T3N_DEVELOPER_KEY_FILE"));
  const expectedDid = await readMode0600Secret(requireEnv("T3N_EXPECTED_DID_FILE"));
  if (did !== expectedDid) throw new Error("Authenticated DID does not match the issuance receipt");
  const usage = await client.getUsage({ limit: 1 });
  process.stdout.write(
    `${JSON.stringify(
      { authenticated: true, didMatchesIssuance: true, balance: usage.balance, network: "sandbox" },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`Quickstart failed: ${sanitizedError(error)}\n`);
  process.exitCode = 1;
});
