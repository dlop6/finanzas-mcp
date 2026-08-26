import {
  isMcpInitializeResult,
  MCP_METHODS,
  MCP_PROTOCOL_VERSION,
  isMcpCallToolResult,
  isMcpListToolsResult,
  type McpCallToolResult,
  type McpImplementationInfo,
  type McpInitializeParams,
  type McpListToolsResult,
} from "@/shared/mcp";
import type { McpJsonRpcTransport, McpRequestContext } from "./mcp-jsonrpc-transport";
import { HOST_MCP_LOG_SESSION_ID } from "./mcp-interaction-log";

export type McpClientState = "DISCONNECTED" | "INITIALIZING" | "READY" | "CLOSED";

export class McpLifecycleError extends Error {
  constructor(public readonly code: "INVALID_STATE" | "PROTOCOL_ERROR", message: string) {
    super(message);
    this.name = "McpLifecycleError";
  }
}

const HOST_INFO: McpImplementationInfo = {
  name: "finanzas-mcp-host",
  version: "0.1.0",
};

export class McpLifecycleClient {
  private currentState: McpClientState = "DISCONNECTED";

  constructor(private readonly transport: McpJsonRpcTransport) {}

  get state(): McpClientState {
    return this.currentState;
  }

  async initialize(): Promise<void> {
    if (this.currentState !== "DISCONNECTED") {
      throw new McpLifecycleError("INVALID_STATE", "MCP client cannot initialize in its current state");
    }

    this.currentState = "INITIALIZING";

    try {
      const params: McpInitializeParams = {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: HOST_INFO,
      };
      const result = await this.transport.request<unknown>(MCP_METHODS.INITIALIZE, params, { sessionId: HOST_MCP_LOG_SESSION_ID });

      if (!isMcpInitializeResult(result)) {
        throw new McpLifecycleError("PROTOCOL_ERROR", "MCP server returned an invalid initialize result");
      }

      await this.transport.notify(MCP_METHODS.INITIALIZED_NOTIFICATION, undefined, { sessionId: HOST_MCP_LOG_SESSION_ID });
      this.currentState = "READY";
    } catch (error) {
      this.currentState = "CLOSED";
      await this.transport.close().catch(() => undefined);
      throw error;
    }
  }

  async toolsList(): Promise<McpListToolsResult> {
    this.assertReady();
    const result = await this.transport.request<unknown>(MCP_METHODS.TOOLS_LIST, undefined, { sessionId: HOST_MCP_LOG_SESSION_ID });
    return this.assertProtocolResult(result, isMcpListToolsResult, "tools/list");
  }

  async toolsCall(name: string, args: Record<string, unknown> = {}, context?: McpRequestContext): Promise<McpCallToolResult> {
    this.assertReady();
    const result = await this.transport.request<unknown>(MCP_METHODS.TOOLS_CALL, { name, arguments: args }, context);
    return this.assertProtocolResult(result, isMcpCallToolResult, "tools/call");
  }

  async close(): Promise<void> {
    if (this.currentState === "CLOSED") {
      return;
    }

    this.currentState = "CLOSED";
    await this.transport.close();
  }

  private assertReady(): void {
    if (this.currentState !== "READY") {
      throw new McpLifecycleError("INVALID_STATE", "MCP client is not ready for tool operations");
    }
  }

  private async assertProtocolResult<Result>(
    result: unknown,
    guard: (value: unknown) => value is Result,
    method: string,
  ): Promise<Result> {
    if (guard(result)) {
      return result;
    }

    this.currentState = "CLOSED";
    await this.transport.close().catch(() => undefined);
    throw new McpLifecycleError("PROTOCOL_ERROR", `MCP server returned an invalid ${method} result`);
  }
}
