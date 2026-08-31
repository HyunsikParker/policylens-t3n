import { readFile, stat } from "node:fs/promises";
import {
  T3nClient,
  createEthAuthInput,
  eth_get_address,
  fetchTrustedManifest,
  getNodeUrl,
  loadWasmComponent,
  metamask_sign,
  setEnvironment,
} from "@terminal3/t3n-sdk";

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function readMode0600Secret(path: string): Promise<string> {
  const metadata = await stat(path);
  if ((metadata.mode & 0o077) !== 0) throw new Error(`${path} must have mode 0600`);
  const value = (await readFile(path, "utf8")).trim();
  if (!value) throw new Error(`${path} is empty`);
  return value;
}

export async function authenticateFromFile(path: string): Promise<{ client: T3nClient; did: string }> {
  setEnvironment("sandbox");
  const privateKey = await readMode0600Secret(path);
  const address = eth_get_address(privateKey);
  const trustAnchor = await fetchTrustedManifest("sandbox", { baseUrl: getNodeUrl() });
  const client = new T3nClient({
    baseUrl: getNodeUrl(),
    wasmComponent: await loadWasmComponent(),
    handlers: { EthSign: metamask_sign(address, undefined, privateKey) },
    trustAnchor,
  });
  await client.handshake();
  const result = await client.authenticate(createEthAuthInput(address));
  return { client, did: result.value };
}

export function sanitizedError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown failure";
  return error.message
    .replace(/t3n_key_[A-Za-z0-9_.-]+/g, "[REDACTED]")
    .replace(/\b(?:0x)?[A-Fa-f0-9]{64}\b/g, "[REDACTED]")
    .replace(/did:t3n:[0-9a-f]{40}/gi, "did:t3n:[REDACTED_DID]")
    .replace(/\b[A-Fa-f0-9]{40}\b/g, "[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{60,}\b/g, "[REDACTED]");
}
