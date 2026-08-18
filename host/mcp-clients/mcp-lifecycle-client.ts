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
import { StdioJsonRpcClient, StdioTransportError } from "./stdio-jsonrpc-client";

export type McpClientState = "DISCONNECTED" | "INITIALIZING" | "READY" | "CLOSED";

const HOST_INFO: McpImplementationInfo = {
  name: "finanzas-mcp-host",
  version: "0.1.0",
};

export class McpLifecycleClient {
  private currentState: McpClientState = "DISCONNECTED";

  constructor(private readonly transport: StdioJsonRpcClient) {}

  get state(): McpClientState {
    return this.currentState;
  }

  async initialize(): Promise<void> {
    if (this.currentState !== "DISCONNECTED") {
      throw new StdioTransportError("INVALID_STATE", "MCP client cannot initialize in its current state");
    }

    this.currentState = "INITIALIZING";

    try {
      const params: McpInitializeParams = {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: HOST_INFO,
      };
      const result = await this.transport.request<unknown>(MCP_METHODS.INITIALIZE, params);

      if (!isMcpInitializeResult(result)) {
        throw new StdioTransportError("PROTOCOL_ERROR", "Finance MCP returned an invalid initialize result");
      }

      await this.transport.notify(MCP_METHODS.INITIALIZED_NOTIFICATION);
      this.currentState = "READY";
    } catch (error) {
      this.currentState = "CLOSED";
      await this.transport.close();
      throw error;
    }
  }

  async toolsList(): Promise<McpListToolsResult> {
    this.assertReady();
    const result = await this.transport.request<unknown>(MCP_METHODS.TOOLS_LIST);
    return this.assertProtocolResult(result, isMcpListToolsResult, "tools/list");
  }

  async toolsCall(name: string, args: Record<string, unknown> = {}): Promise<McpCallToolResult> {
    this.assertReady();
    const result = await this.transport.request<unknown>(MCP_METHODS.TOOLS_CALL, { name, arguments: args });
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
      throw new StdioTransportError("INVALID_STATE", "MCP client is not ready for tool operations");
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
    await this.transport.close();
    throw new StdioTransportError("PROTOCOL_ERROR", `Finance MCP returned an invalid ${method} result`);
  }
}
