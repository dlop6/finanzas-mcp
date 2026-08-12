import {
  createInvalidParamsResponse,
  createInvalidRequestResponse,
  createJsonRpcErrorResponse,
  createJsonRpcSuccessResponse,
  createMethodNotFoundResponse,
  isJsonRpcRequest,
  type JsonRpcErrorResponse,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcSuccessResponse,
} from "@/shared/jsonrpc";
import {
  isMcpInitializeRequestParams,
  MCP_METHODS,
  MCP_PROTOCOL_VERSION,
  type McpInitializeResult,
} from "@/shared/mcp";
import type { FinanceMcpMessageHandler } from "./stdio-server";

export type FinanceMcpLifecycleState = "AWAITING_INITIALIZE" | "AWAITING_INITIALIZED" | "READY";

const FINANCE_MCP_INFO = {
  name: "finance-mcp",
  version: "0.1.0",
} as const;

const INITIALIZE_RESULT: McpInitializeResult = {
  protocolVersion: MCP_PROTOCOL_VERSION,
  capabilities: { tools: {} },
  serverInfo: FINANCE_MCP_INFO,
};

export class FinanceMcpLifecycle {
  private currentState: FinanceMcpLifecycleState = "AWAITING_INITIALIZE";

  get state(): FinanceMcpLifecycleState {
    return this.currentState;
  }

  readonly handleMessage: FinanceMcpMessageHandler = (message) => {
    if (isJsonRpcRequest(message)) {
      return this.handleRequest(message);
    }

    this.handleNotification(message);
    return undefined;
  };

  private handleRequest(request: JsonRpcRequest): JsonRpcSuccessResponse | JsonRpcErrorResponse {
    if (request.method !== MCP_METHODS.INITIALIZE) {
      return createMethodNotFoundResponse(request.id);
    }

    if (this.currentState !== "AWAITING_INITIALIZE") {
      return createInvalidRequestResponse(request.id);
    }

    if (!isMcpInitializeRequestParams(request.params)) {
      return createInvalidParamsResponse(request.id);
    }

    if (request.params.protocolVersion !== MCP_PROTOCOL_VERSION) {
      return createJsonRpcErrorResponse({
        id: request.id,
        code: -32602,
        message: "Unsupported protocol version",
        data: { supported: [MCP_PROTOCOL_VERSION], requested: request.params.protocolVersion },
      });
    }

    this.currentState = "AWAITING_INITIALIZED";
    return createJsonRpcSuccessResponse(request.id, INITIALIZE_RESULT);
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (
      this.currentState === "AWAITING_INITIALIZED" &&
      notification.method === MCP_METHODS.INITIALIZED_NOTIFICATION
    ) {
      this.currentState = "READY";
    }
  }
}
