import type { JsonRpcErrorResponse, JsonRpcRequest, JsonRpcSuccessResponse } from "@/shared/jsonrpc";
import { createFinanceToolRegistry } from "@/servers/finance-mcp/composition";
import { FinanceMcpLifecycle } from "@/servers/finance-mcp/lifecycle";
import type { FinanceClock } from "@/servers/finance-mcp/services";
import type { McpCallToolResult, McpInitializeResult, McpListToolsResult } from "@/shared/mcp";
import { isMcpCallToolResult, isMcpInitializeResult, isMcpListToolsResult } from "@/shared/mcp";
import type { PrismaClient } from "@/database/generated/prisma/client";

type Response = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export class FinanceMcpTestHarness {
  private readonly lifecycle: FinanceMcpLifecycle;
  private nextId = 1;

  constructor(private readonly prisma: PrismaClient, clock: FinanceClock) {
    this.lifecycle = new FinanceMcpLifecycle(createFinanceToolRegistry(prisma, { clock }));
  }

  async initialize(): Promise<McpInitializeResult> {
    const response = await this.lifecycle.handleMessage({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "finance-integration-test", version: "1.0.0" },
      },
    });
    if (!response || !isSuccess(response) || !isMcpInitializeResult(response.result)) throw new Error("Finance MCP test handshake failed");
    await this.lifecycle.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    return response.result;
  }

  async listTools(): Promise<McpListToolsResult> {
    const response = await this.request("tools/list", {});
    if (!isSuccess(response) || !isMcpListToolsResult(response.result)) throw new Error("Invalid tools/list response");
    return response.result;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
    const response = await this.request("tools/call", { name, arguments: args });
    if (!isSuccess(response) || !isMcpCallToolResult(response.result)) throw new Error("Invalid tools/call response");
    return response.result;
  }

  async callRaw(name: string, args: Record<string, unknown>): Promise<Response> {
    return this.request("tools/call", { name, arguments: args });
  }

  private async request(method: string, params: Record<string, unknown>): Promise<Response> {
    const response = await this.lifecycle.handleMessage({ jsonrpc: "2.0", id: this.nextId++, method, params } as JsonRpcRequest);
    if (!response) throw new Error("Finance MCP did not return a response");
    return response;
  }
}

function isSuccess(response: Response): response is JsonRpcSuccessResponse {
  return "result" in response;
}
