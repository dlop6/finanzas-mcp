import { describe, expect, it, vi } from "vitest";
import { FinanceToolRegistry, type FinanceToolDefinition } from "@/servers/finance-mcp/tools/registry";

const echoTool: FinanceToolDefinition = {
  name: "test.echo",
  description: "Returns a test message.",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
    additionalProperties: false,
  },
  isWriteOperation: false,
  handler: async ({ message }) => ({ content: [{ type: "text", text: String(message) }] }),
};

describe("FinanceToolRegistry", () => {
  it("lists only public tool definitions and executes valid arguments", async () => {
    const registry = new FinanceToolRegistry([echoTool]);

    expect(registry.list()).toEqual([
      { name: "test.echo", description: "Returns a test message.", inputSchema: echoTool.inputSchema },
    ]);
    expect(registry.list()[0]).not.toHaveProperty("isWriteOperation");
    expect(registry.list()[0]).not.toHaveProperty("handler");

    await expect(registry.execute("test.echo", { message: "hello" })).resolves.toEqual({
      ok: true,
      result: { content: [{ type: "text", text: "hello" }] },
    });
  });

  it("fails fast for duplicate and invalid definitions", () => {
    expect(() => new FinanceToolRegistry([echoTool, echoTool])).toThrow("Duplicate Finance MCP tool");
    expect(() => new FinanceToolRegistry([{ ...echoTool, name: "invalid name" }])).toThrow("tool name");
    expect(() => new FinanceToolRegistry([{ ...echoTool, description: " " }])).toThrow("description");
    expect(() => new FinanceToolRegistry([{ ...echoTool, inputSchema: { type: "string" } }])).toThrow("root type");
  });

  it("does not execute a handler when arguments violate its input schema", async () => {
    const handler = vi.fn(echoTool.handler);
    const registry = new FinanceToolRegistry([{ ...echoTool, handler }]);

    await expect(registry.execute("test.echo", {})).resolves.toMatchObject({
      ok: false,
      reason: "INVALID_ARGUMENTS",
      result: { isError: true },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("reports an unknown tool without executing a handler", async () => {
    const registry = new FinanceToolRegistry([echoTool]);
    await expect(registry.execute("missing.tool", {})).resolves.toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("rejects invalid handler results", async () => {
    const registry = new FinanceToolRegistry([
      { ...echoTool, handler: () => ({ content: [{ type: "unknown", text: "bad" }] } as never) },
    ]);

    await expect(registry.execute("test.echo", { message: "hello" })).rejects.toThrow("invalid result");
  });
});
