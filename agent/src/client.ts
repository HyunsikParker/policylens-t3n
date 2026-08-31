import { invoke, type InvokeOptions } from "@terminal3/t3n-sdk";
import type { AgentConfig } from "./config.js";
import {
  parseDecisionReceipt,
  parseHealthResponse,
  parseProcurementRequest,
  type DecisionReceipt,
  type HealthResponse,
  type ProcurementRequest,
} from "./domain.js";

export type InvokeFunction = (options: InvokeOptions) => Promise<unknown>;
export type SessionExecuteFunction = (functionName: string, input: unknown) => Promise<unknown>;

export class PolicyLensClient {
  readonly #config: AgentConfig;
  readonly #invoke: InvokeFunction;

  constructor(config: AgentConfig, invokeFunction: InvokeFunction = (options) => invoke(options)) {
    this.#config = config;
    this.#invoke = invokeFunction;
  }

  async evaluate(value: unknown): Promise<DecisionReceipt> {
    const request = parseProcurementRequest(value);
    const response = await this.#call("evaluate-request", request);
    return parseDecisionReceipt(response);
  }

  async getDecision(requestId: string): Promise<DecisionReceipt> {
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(requestId)) throw new Error("request_id is invalid");
    const response = await this.#call("get-decision", { request_id: requestId });
    return parseDecisionReceipt(response);
  }

  async health(): Promise<HealthResponse> {
    const response = await this.#call("health", {});
    return parseHealthResponse(response);
  }

  async #call(functionName: string, input: ProcurementRequest | { request_id: string } | Record<string, never>) {
    return this.#invoke({
      baseUrl: this.#config.baseUrl,
      apiKey: this.#config.apiKey,
      timeoutMs: this.#config.timeoutMs,
      request: {
        contract_id: this.#config.contractId,
        contract_version: this.#config.contractVersion,
        function_name: functionName,
        pii_did: this.#config.subjectDid,
        input,
      },
    });
  }
}

/**
 * Authenticated-session adapter for owners operating their own tenant contract.
 * This uses the same strict input/output validation as the stateless agent-key
 * client while keeping session construction outside the domain client.
 */
export class SessionPolicyLensClient {
  readonly #execute: SessionExecuteFunction;

  constructor(execute: SessionExecuteFunction) {
    this.#execute = execute;
  }

  async evaluate(value: unknown): Promise<DecisionReceipt> {
    const request = parseProcurementRequest(value);
    return parseDecisionReceipt(await this.#execute("evaluate-request", request));
  }

  async getDecision(requestId: string): Promise<DecisionReceipt> {
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(requestId)) throw new Error("request_id is invalid");
    return parseDecisionReceipt(await this.#execute("get-decision", { request_id: requestId }));
  }

  async health(): Promise<HealthResponse> {
    return parseHealthResponse(await this.#execute("health", {}));
  }
}
