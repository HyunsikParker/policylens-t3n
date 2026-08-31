import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { PolicyLensClient } from "./client.js";

function usage(): never {
  throw new Error(
    "usage: policylens health | policylens evaluate --file <request.json> | policylens get --request-id <id>",
  );
}

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) usage();
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) usage();
  const client = new PolicyLensClient(loadConfig());
  let output: unknown;

  if (command === "health" && args.length === 0) {
    output = await client.health();
  } else if (command === "evaluate") {
    const file = option(args, "--file");
    output = await client.evaluate(JSON.parse(await readFile(file, "utf8")) as unknown);
  } else if (command === "get") {
    output = await client.getDecision(option(args, "--request-id"));
  } else {
    usage();
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(`PolicyLens failed: ${message}\n`);
  process.exitCode = 1;
});
