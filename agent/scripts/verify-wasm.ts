import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { requireEnv } from "./lib.js";

const execFileAsync = promisify(execFile);

const expectedHostImports = [
  "host:interfaces/kv-store@2.1.0",
  "host:interfaces/logging@2.1.0",
  "host:tenant/tenant-context@1.0.0",
];
const expectedExports = [
  "evaluate-request: func",
  "get-decision: func",
  "health: func",
];

async function main(): Promise<void> {
  const wasmPath = requireEnv("POLICYLENS_WASM_FILE");
  const metadata = await stat(wasmPath);
  if (metadata.size > 2 * 1024 * 1024) throw new Error(`WASM exceeds 2 MiB: ${metadata.size}`);
  const witPath = process.env.POLICYLENS_COMPONENT_WIT_FILE?.trim();
  const wit = witPath
    ? await readFile(witPath, "utf8")
    : (await execFileAsync("wasm-tools", ["component", "wit", wasmPath], { maxBuffer: 2 * 1024 * 1024 })).stdout;
  const hostImports = [...wit.matchAll(/^\s*import\s+(host:[^;]+);$/gm)]
    .map((match) => match[1])
    .sort();
  if (JSON.stringify(hostImports) !== JSON.stringify(expectedHostImports)) {
    throw new Error(`unexpected T3N host imports: ${hostImports.join(", ")}`);
  }
  for (const required of expectedExports) {
    if (!wit.includes(required)) throw new Error(`missing contract export: ${required}`);
  }
  const forbidden = ["http", "http-with-placeholders", "signing", "user-profile", "secret"];
  if (forbidden.some((capability) => wit.includes(`host:interfaces/${capability}`))) {
    throw new Error("component contains a forbidden T3N host capability");
  }
  const nonHostImports = [...wit.matchAll(/^\s*import\s+([^;]+);$/gm)]
    .map((match) => match[1] ?? "")
    .filter((name) => !name.startsWith("host:"));
  if (nonHostImports.some((name) => !name.startsWith("wasi:"))) {
    throw new Error(`unexpected non-WASI import: ${nonHostImports.join(", ")}`);
  }
  const wasm = await readFile(wasmPath);
  process.stdout.write(`${JSON.stringify({
    valid: true,
    wasm_bytes: metadata.size,
    wasm_sha256: createHash("sha256").update(wasm).digest("hex"),
    t3n_host_imports: hostImports,
    standard_wasi_import_count: nonHostImports.length,
    forbidden_t3n_host_imports: 0,
    exports: ["evaluate-request", "get-decision", "health"],
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(`WASM verification failed: ${message}\n`);
  process.exitCode = 1;
});
