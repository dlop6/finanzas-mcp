import { describe, expect, it, vi } from "vitest";
import type { McpTool } from "@/shared/mcp";
import {
  HostMcpToolRegistry,
  HostToolRegistryError,
  type McpToolClient,
} from "@/host/orchestration/mcp-tool-registry";

function tool(name: string, description = `${name} description`): McpTool {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "integer", minimum: 1 } },
    },
  };
}

function client(tools: McpTool[]) {
  return {
    toolsList: vi.fn(async () => ({ tools })),
    toolsCall: vi.fn(async () => ({ content: [] })),
  } satisfies McpToolClient;
}

describe("Host MCP tool registry", () => {
  it("registers, converts, and resolves tools without executing them", async () => {
    const registry = new HostMcpToolRegistry();
    const financeClient = client([tool("read_balance"), tool("record_income")]);

    await registry.registerServer({
      serverId: "finance-mcp",
      client: financeClient,
      metadata: {
        read_balance: { isWriteOperation: false },
        record_income: { isWriteOperation: true },
      },
    });

    expect(financeClient.toolsList).toHaveBeenCalledOnce();
    expect(financeClient.toolsCall).not.toHaveBeenCalled();
    expect(registry.list()).toMatchObject([
      { serverId: "finance-mcp", definition: { name: "read_balance" }, isWriteOperation: false },
      { serverId: "finance-mcp", definition: { name: "record_income" }, isWriteOperation: true },
    ]);
    expect(registry.resolve("record_income")).toMatchObject({
      serverId: "finance-mcp",
      client: financeClient,
      isWriteOperation: true,
    });
    expect(registry.toDeepSeekTools()).toEqual([
      {
        type: "function",
        function: {
          name: "read_balance",
          description: "read_balance description",
          parameters: tool("read_balance").inputSchema,
        },
      },
      {
        type: "function",
        function: {
          name: "record_income",
          description: "record_income description",
          parameters: tool("record_income").inputSchema,
        },
      },
    ]);
  });

  it("keeps registration atomic for discovery, metadata, and duplicate failures", async () => {
    const registry = new HostMcpToolRegistry();
    const first = client([tool("first_tool")]);
    await registry.registerServer({
      serverId: "first",
      client: first,
      metadata: { first_tool: { isWriteOperation: false } },
    });

    const failingClient: McpToolClient = {
      toolsList: vi.fn(async () => {
        throw new Error("not ready");
      }),
      toolsCall: vi.fn(async () => ({ content: [] })),
    };
    await expect(registry.registerServer({ serverId: "failed", client: failingClient, metadata: {} })).rejects.toMatchObject({
      code: "DISCOVERY_FAILED",
    });
    await expect(registry.registerServer({
      serverId: "missing-metadata",
      client: client([tool("missing_tool")]),
      metadata: {},
    })).rejects.toMatchObject({ code: "MISSING_METADATA" });
    await expect(registry.registerServer({
      serverId: "duplicate",
      client: client([tool("first_tool"), tool("second_tool")]),
      metadata: { first_tool: { isWriteOperation: false }, second_tool: { isWriteOperation: false } },
    })).rejects.toMatchObject({ code: "DUPLICATE_TOOL" });

    expect(registry.list().map((entry) => entry.definition.name)).toEqual(["first_tool"]);
  });

  it("rejects invalid servers, stale metadata, duplicate local names, and incompatible DeepSeek names", async () => {
    const registry = new HostMcpToolRegistry();
    await expect(registry.registerServer({ serverId: " ", client: client([]), metadata: {} })).rejects.toMatchObject({
      code: "INVALID_SERVER_ID",
    });
    await expect(registry.registerServer({
      serverId: "stale",
      client: client([tool("known_tool")]),
      metadata: { known_tool: { isWriteOperation: false }, removed_tool: { isWriteOperation: false } },
    })).rejects.toMatchObject({ code: "UNEXPECTED_METADATA" });
    await expect(registry.registerServer({
      serverId: "duplicates",
      client: client([tool("same_tool"), tool("same_tool")]),
      metadata: { same_tool: { isWriteOperation: false } },
    })).rejects.toMatchObject({ code: "DUPLICATE_TOOL" });
    await expect(registry.registerServer({
      serverId: "incompatible",
      client: client([tool("tool.with.dot")]),
      metadata: { "tool.with.dot": { isWriteOperation: false } },
    })).rejects.toMatchObject({ code: "INCOMPATIBLE_TOOL" });
  });

  it("preserves registration order, routes multiple servers, and returns defensive copies", async () => {
    const registry = new HostMcpToolRegistry();
    const financeClient = client([tool("finance_read")]);
    const filesystemClient = client([tool("filesystem_read")]);
    await registry.registerServer({
      serverId: "finance-mcp",
      client: financeClient,
      metadata: { finance_read: { isWriteOperation: false } },
    });
    await registry.registerServer({
      serverId: "filesystem-mcp",
      client: filesystemClient,
      metadata: { filesystem_read: { isWriteOperation: false } },
    });

    expect(registry.list().map((entry) => entry.definition.name)).toEqual(["finance_read", "filesystem_read"]);
    expect(registry.resolve("filesystem_read").client).toBe(filesystemClient);
    expect(() => registry.resolve("missing_tool")).toThrow(HostToolRegistryError);

    const listed = registry.list();
    (listed[0].definition.inputSchema.properties as Record<string, unknown>).id = { type: "string" };
    const deepSeekTools = registry.toDeepSeekTools();
    (deepSeekTools[0].function.parameters.properties as Record<string, unknown>).id = { type: "string" };
    expect(registry.toDeepSeekTools()[0].function.parameters).toEqual(tool("finance_read").inputSchema);
  });

  it("rejects registering the same server twice", async () => {
    const registry = new HostMcpToolRegistry();
    const financeClient = client([]);
    await registry.registerServer({ serverId: "finance-mcp", client: financeClient, metadata: {} });
    await expect(registry.registerServer({ serverId: "finance-mcp", client: financeClient, metadata: {} })).rejects.toMatchObject({
      code: "SERVER_ALREADY_REGISTERED",
    });
  });

  it("removes a registered server so a failed composition can recover", async () => {
    const registry = new HostMcpToolRegistry();
    const filesystemClient = client([tool("filesystem_read")]);
    await registry.registerServer({
      serverId: "filesystem-mcp",
      client: filesystemClient,
      metadata: { filesystem_read: { isWriteOperation: false } },
    });

    registry.unregisterServer("filesystem-mcp");

    expect(registry.list()).toEqual([]);
    await expect(registry.registerServer({
      serverId: "filesystem-mcp",
      client: filesystemClient,
      metadata: { filesystem_read: { isWriteOperation: false } },
    })).resolves.toBeUndefined();
  });
});
