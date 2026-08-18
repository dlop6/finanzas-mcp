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
  isMcpCallToolParams,
  isMcpListToolsParams,
  MCP_METHODS,
  MCP_PROTOCOL_VERSION,
  toMcpCallToolParams,
  type McpInitializeResult,
} from "@/shared/mcp";
import type { FinanceMcpMessageHandler } from "./stdio-server";
import { FinanceToolRegistry } from "./tools/registry";

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

  constructor(private readonly tools = new FinanceToolRegistry()) {}

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

  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse> {
    if (request.method === MCP_METHODS.INITIALIZE) {
      return this.handleInitialize(request);
    }

    if (request.method === MCP_METHODS.TOOLS_LIST || request.method === MCP_METHODS.TOOLS_CALL) {
      if (this.currentState !== "READY") {
        return createInvalidRequestResponse(request.id);
      }

      return request.method === MCP_METHODS.TOOLS_LIST ? this.handleToolsList(request) : this.handleToolsCall(request);
    }

    return createMethodNotFoundResponse(request.id);
  }

  private handleInitialize(request: JsonRpcRequest): JsonRpcSuccessResponse | JsonRpcErrorResponse {
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

  private handleToolsList(request: JsonRpcRequest): JsonRpcSuccessResponse | JsonRpcErrorResponse {
    if (!isMcpListToolsParams(request.params)) {
      return createInvalidParamsResponse(request.id);
    }

    return createJsonRpcSuccessResponse(request.id, { tools: this.tools.list() });
  }

  private async handleToolsCall(request: JsonRpcRequest): Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse> {
    if (!isMcpCallToolParams(request.params)) {
      return createInvalidParamsResponse(request.id);
    }

    const params = toMcpCallToolParams(request.params);
    const execution = await this.tools.execute(params.name, params.arguments);
    if (!execution.ok && execution.reason === "NOT_FOUND") {
      return createInvalidParamsResponse(request.id);
    }

    return createJsonRpcSuccessResponse(request.id, execution.result);
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
