export const dataClassifications = ["public", "internal", "confidential", "restricted"] as const;
export const businessPurposes = [
  "customer_delivery",
  "internal_operations",
  "research",
  "compliance",
] as const;

export type DataClassification = (typeof dataClassifications)[number];
export type BusinessPurpose = (typeof businessPurposes)[number];
export type Decision = "approve" | "human_review" | "deny";

export interface ProcurementRequest {
  request_id: string;
  category: string;
  amount_usd_cents: number;
  currency: "USD";
  vendor_country: string;
  data_classification: DataClassification;
  security_reviewed: boolean;
  business_purpose: BusinessPurpose;
}

export interface DecisionReceipt {
  request_id: string;
  decision: Decision;
  reason_codes: string[];
  policy_version: string;
  request_fingerprint: string;
  audited_at_epoch_secs: number;
  ledger_seq: number;
  replayed: boolean;
}

export interface HealthResponse {
  status: "ok";
  contract: "policy-lens";
  version: string;
  storage: "tenant_private_kv";
  outbound_network: false;
  accepted_functions: string[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function strictKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${label} contains unsupported fields: ${unknown.sort().join(", ")}`);
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`${key} must be a string`);
  return field;
}

export function parseProcurementRequest(value: unknown): ProcurementRequest {
  const input = record(value, "request");
  strictKeys(
    input,
    [
      "request_id",
      "category",
      "amount_usd_cents",
      "currency",
      "vendor_country",
      "data_classification",
      "security_reviewed",
      "business_purpose",
    ],
    "request",
  );

  const request_id = stringField(input, "request_id");
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(request_id)) {
    throw new Error("request_id must be 3-64 ASCII letters, digits, '-' or '_'");
  }
  const category = stringField(input, "category");
  if (!/^[a-z0-9_]{2,48}$/.test(category)) {
    throw new Error("category must be 2-48 lowercase ASCII letters, digits or '_'");
  }
  const amount = input.amount_usd_cents;
  if (!Number.isSafeInteger(amount) || (amount as number) < 1 || (amount as number) > 1_000_000_000) {
    throw new Error("amount_usd_cents must be a safe integer between 1 and 1000000000");
  }
  const currency = stringField(input, "currency");
  if (currency !== "USD") throw new Error("currency must be USD");
  const vendor_country = stringField(input, "vendor_country");
  if (!/^[A-Z]{2}$/.test(vendor_country)) {
    throw new Error("vendor_country must be a two-letter uppercase country code");
  }
  const classification = stringField(input, "data_classification");
  if (!(dataClassifications as readonly string[]).includes(classification)) {
    throw new Error(`data_classification must be one of ${dataClassifications.join(", ")}`);
  }
  if (typeof input.security_reviewed !== "boolean") {
    throw new Error("security_reviewed must be a boolean");
  }
  const purpose = stringField(input, "business_purpose");
  if (!(businessPurposes as readonly string[]).includes(purpose)) {
    throw new Error(`business_purpose must be one of ${businessPurposes.join(", ")}`);
  }

  return {
    request_id,
    category,
    amount_usd_cents: amount as number,
    currency: "USD",
    vendor_country,
    data_classification: classification as DataClassification,
    security_reviewed: input.security_reviewed,
    business_purpose: purpose as BusinessPurpose,
  };
}

export function parseDecisionReceipt(value: unknown): DecisionReceipt {
  const receipt = record(value, "decision receipt");
  strictKeys(
    receipt,
    [
      "request_id",
      "decision",
      "reason_codes",
      "policy_version",
      "request_fingerprint",
      "audited_at_epoch_secs",
      "ledger_seq",
      "replayed",
    ],
    "decision receipt",
  );
  const decision = stringField(receipt, "decision");
  if (!(["approve", "human_review", "deny"] as const).includes(decision as Decision)) {
    throw new Error("decision receipt contains an invalid decision");
  }
  if (!Array.isArray(receipt.reason_codes) || !receipt.reason_codes.every((item) => typeof item === "string")) {
    throw new Error("decision receipt reason_codes must be strings");
  }
  const auditedAt = receipt.audited_at_epoch_secs;
  const ledgerSeq = receipt.ledger_seq;
  if (!Number.isSafeInteger(auditedAt) || (auditedAt as number) < 0) {
    throw new Error("decision receipt audited_at_epoch_secs is invalid");
  }
  if (!Number.isSafeInteger(ledgerSeq) || (ledgerSeq as number) < 0) {
    throw new Error("decision receipt ledger_seq is invalid");
  }
  if (typeof receipt.replayed !== "boolean") throw new Error("decision receipt replayed must be boolean");
  const fingerprint = stringField(receipt, "request_fingerprint");
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("decision receipt fingerprint is invalid");
  return {
    request_id: stringField(receipt, "request_id"),
    decision: decision as Decision,
    reason_codes: [...receipt.reason_codes],
    policy_version: stringField(receipt, "policy_version"),
    request_fingerprint: fingerprint,
    audited_at_epoch_secs: auditedAt as number,
    ledger_seq: ledgerSeq as number,
    replayed: receipt.replayed,
  };
}

export function parseHealthResponse(value: unknown): HealthResponse {
  const health = record(value, "health response");
  if (
    health.status !== "ok" ||
    health.contract !== "policy-lens" ||
    typeof health.version !== "string" ||
    health.storage !== "tenant_private_kv" ||
    health.outbound_network !== false ||
    !Array.isArray(health.accepted_functions) ||
    !health.accepted_functions.every((item) => typeof item === "string")
  ) {
    throw new Error("health response does not match the PolicyLens contract");
  }
  return health as unknown as HealthResponse;
}
