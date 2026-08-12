import { describe, expect, it } from "vitest";
import { isJsonRpcErrorResponse, isJsonRpcSuccessResponse } from "@/shared/jsonrpc";
import { MCP_METHODS, MCP_PROTOCOL_VERSION } from "@/shared/mcp";
import { FinanceMcpLifecycle } from "@/servers/finance-mcp/lifecycle";

describe("Finance MCP lifecycle", () => {
  it("negotiates the shared protocol version and becomes ready after initialized", async () => {
    const lifecycle = new FinanceMcpLifecycle();
    const response = await lifecycle.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: MCP_METHODS.INITIALIZE,
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-host", version: "0.1.0" },
      },
    });

    expect(isJsonRpcSuccessResponse(response)).toBe(true);
    expect(response).toMatchObject({
      id: 1,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "finance-mcp", version: "0.1.0" },
      },
    });
    expect(lifecycle.state).toBe("AWAITING_INITIALIZED");

    await lifecycle.handleMessage({
      jsonrpc: "2.0",
      method: MCP_METHODS.INITIALIZED_NOTIFICATION,
    });

    expect(lifecycle.state).toBe("READY");
  });

  it("rejects invalid and unsupported initialize requests without becoming ready", async () => {
    const invalidLifecycle = new FinanceMcpLifecycle();
    const invalidResponse = await invalidLifecycle.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: MCP_METHODS.INITIALIZE,
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} },
    });

    expect(isJsonRpcErrorResponse(invalidResponse)).toBe(true);
    expect(invalidResponse).toMatchObject({ error: { code: -32602 } });
    expect(invalidLifecycle.state).toBe("AWAITING_INITIALIZE");

    const unsupportedLifecycle = new FinanceMcpLifecycle();
    const unsupportedResponse = await unsupportedLifecycle.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: MCP_METHODS.INITIALIZE,
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-host", version: "0.1.0" },
      },
    });

    expect(isJsonRpcErrorResponse(unsupportedResponse)).toBe(true);
    expect(unsupportedResponse).toMatchObject({
      error: {
        code: -32602,
        message: "Unsupported protocol version",
        data: { supported: [MCP_PROTOCOL_VERSION], requested: "2024-11-05" },
      },
    });
    expect(unsupportedLifecycle.state).toBe("AWAITING_INITIALIZE");
  });
});
