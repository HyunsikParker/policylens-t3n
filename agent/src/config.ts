import { open } from "node:fs/promises";

export class ConfigError extends Error {}

export interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  contractId: string;
  contractVersion: string;
  subjectDid: string;
  timeoutMs: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is required`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const baseUrl = required(env, "T3N_NODE_URL");
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new ConfigError("T3N_NODE_URL must be a valid origin URL"); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new ConfigError("T3N_NODE_URL must be an origin without credentials, path, query or fragment");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new ConfigError("T3N_NODE_URL must use HTTPS (HTTP is allowed only for loopback testing)");
  }
  const apiKey = required(env, "T3N_AGENT_API_KEY");
  if (!apiKey.startsWith("t3n_key_")) throw new ConfigError("T3N_AGENT_API_KEY has an unexpected format");
  const contractId = required(env, "T3N_CONTRACT_ID");
  if (!/^z:[0-9a-f]{40}:policy-lens$/.test(contractId)) {
    throw new ConfigError("T3N_CONTRACT_ID must be the canonical z:<40-hex>:policy-lens name");
  }
  const contractVersion = env.T3N_CONTRACT_VERSION?.trim() || "0.1.0";
  if (!/^\d+\.\d+\.\d+$/.test(contractVersion)) throw new ConfigError("T3N_CONTRACT_VERSION must be semver");
  const subjectDid = required(env, "T3N_SUBJECT_DID");
  if (!/^did:t3n:[0-9a-f]{40}$/.test(subjectDid)) throw new ConfigError("T3N_SUBJECT_DID must be did:t3n:<40-hex>");
  const timeoutMs = Number(env.T3N_TIMEOUT_MS ?? "30000");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new ConfigError("T3N_TIMEOUT_MS must be an integer between 1000 and 120000");
  }
  return { baseUrl, apiKey, contractId, contractVersion, subjectDid, timeoutMs };
}

/** Load the CLI credential from the same private file used by provisioning. */
export async function loadFileConfig(env: NodeJS.ProcessEnv = process.env): Promise<AgentConfig> {
  if (env.T3N_AGENT_API_KEY?.trim()) {
    throw new ConfigError("Use T3N_AGENT_API_KEY_FILE instead of T3N_AGENT_API_KEY");
  }
  const path = required(env, "T3N_AGENT_API_KEY_FILE");
  const file = await open(path, "r").catch(() => {
    throw new ConfigError("T3N_AGENT_API_KEY_FILE could not be opened");
  });
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
      throw new ConfigError("T3N_AGENT_API_KEY_FILE must be a regular mode-0600 file");
    }
    if (metadata.size > 4096) throw new ConfigError("Credential file exceeds the size limit");
    const apiKey = (await file.readFile("utf8")).trim();
    return loadConfig({ ...env, T3N_AGENT_API_KEY: apiKey });
  } finally {
    await file.close();
  }
}
