import { describe, expect, it } from "vitest";
import { isJsonRpcErrorResponse, isJsonRpcSuccessResponse } from "@/shared/jsonrpc";
import { MCP_METHODS, MCP_PROTOCOL_VERSION } from "@/shared/mcp";
import { FinanceMcpLifecycle } from "@/servers/finance-mcp/lifecycle";
import { FinanceToolRegistry, type FinanceToolDefinition } from "@/servers/finance-mcp/tools/registry";

const testTool: FinanceToolDefinition = {
  name: "test.echo",
  description: "Returns a test message.",
  inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
  isWriteOperation: false,
  handler: ({ message }) => ({ content: [{ type: "text", text: String(message) }] }),
};

async function readyLifecycle(): Promise<FinanceMcpLifecycle> {
  const lifecycle = new FinanceMcpLifecycle(new FinanceToolRegistry([testTool]));
  await lifecycle.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: MCP_METHODS.INITIALIZE,
    params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test", version: "1" } },
  });
  await lifecycle.handleMessage({ jsonrpc: "2.0", method: MCP_METHODS.INITIALIZED_NOTIFICATION });
  return lifecycle;
}

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

  it("lists and calls registered tools only after the lifecycle is ready", async () => {
    const lifecycle = new FinanceMcpLifecycle(new FinanceToolRegistry([testTool]));
    const beforeReady = await lifecycle.handleMessage({ jsonrpc: "2.0", id: 1, method: MCP_METHODS.TOOLS_LIST });
    expect(beforeReady).toMatchObject({ id: 1, error: { code: -32600 } });
    const callBeforeReady = await lifecycle.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: MCP_METHODS.TOOLS_CALL,
      params: { name: "test.echo", arguments: { message: "hello" } },
    });
    expect(callBeforeReady).toMatchObject({ id: 2, error: { code: -32600 } });

    const ready = await readyLifecycle();
    const listed = await ready.handleMessage({ jsonrpc: "2.0", id: 2, method: MCP_METHODS.TOOLS_LIST });
    expect(listed).toMatchObject({
      id: 2,
      result: { tools: [{ name: testTool.name, description: testTool.description, inputSchema: testTool.inputSchema }] },
    });
    expect(listed).not.toMatchObject({ result: { tools: [{ isWriteOperation: expect.anything() }] } });

    const called = await ready.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: MCP_METHODS.TOOLS_CALL,
      params: { name: "test.echo", arguments: { message: "hello" } },
    });
    expect(called).toMatchObject({ id: 3, result: { content: [{ type: "text", text: "hello" }] } });
  });

  it("returns controlled tool errors without leaving the lifecycle ready state", async () => {
    const lifecycle = await readyLifecycle();
    const invalidArguments = await lifecycle.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: MCP_METHODS.TOOLS_CALL,
      params: { name: "test.echo", arguments: {} },
    });
    expect(invalidArguments).toMatchObject({ id: 1, result: { isError: true } });

    const missingTool = await lifecycle.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: MCP_METHODS.TOOLS_CALL,
      params: { name: "missing.tool", arguments: {} },
    });
    expect(missingTool).toMatchObject({ id: 2, error: { code: -32602 } });
    expect(lifecycle.state).toBe("READY");
  });
});
