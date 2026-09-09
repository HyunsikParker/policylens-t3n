import { readFile } from "node:fs/promises";
import { ConfigError, loadFileConfig } from "./config.js";
import { PolicyLensClient } from "./client.js";
import { parseProcurementRequest } from "./domain.js";

const usage = "usage: policylens check-config | validate --file <request.json> | health | evaluate --file <request.json> | get --request-id <id>";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" && args.length === 0) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const noArgs = (command === "health" || command === "check-config") && args.length === 0;
  const fileArgs = (command === "evaluate" || command === "validate") && args.length === 2 && args[0] === "--file";
  const getArgs = command === "get" && args.length === 2 && args[0] === "--request-id";
  if (!noArgs && !fileArgs && !getArgs) throw new Error(usage);
  if (args[1]?.startsWith("--")) throw new Error(usage);

  // Validate before credentials are loaded or a transport client is constructed.
  let request;
  if (fileArgs) {
    let raw;
    try {
      raw = JSON.parse(await readFile(args[1]!, "utf8")) as unknown;
    } catch {
      throw new Error("Request file must be readable JSON; its contents were not sent");
    }
    try {
      request = parseProcurementRequest(raw);
    } catch {
      throw new Error("Request does not match the bounded procurement schema; its contents were not sent");
    }
    if (command === "validate") {
      process.stdout.write(`${JSON.stringify({ valid: true, network_calls: 0, fields: 8 })}\n`);
      return;
    }
  }

  let config;
  try {
    config = await loadFileConfig();
  } catch (error) {
    const reason = error instanceof ConfigError ? error.message : "Credential file could not be read";
    throw new Error(`Configuration invalid: ${reason}; no request was sent`);
  }
  if (command === "check-config") {
    process.stdout.write(`${JSON.stringify({ valid: true, network_calls: 0, credential_source: "mode-0600 file", authenticated: false })}\n`);
    return;
  }
  const client = new PolicyLensClient(config);
  let output: unknown;
  try {
    if (command === "health") output = await client.health();
    else if (command === "evaluate") output = await client.evaluate(request);
    else output = await client.getDecision(args[1]!);
  } catch {
    // SDK / server error text and malformed responses can contain private input.
    throw new Error("Contract call failed or returned an invalid response; check service status, credits and the exact grant before retrying");
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`PolicyLens failed: ${error instanceof Error ? error.message : "unknown failure"}\n`);
  process.exitCode = 1;
});
