import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createJsonRpcSuccessResponse } from "@/shared/jsonrpc";
import { runFinanceMcpStdioServer } from "@/servers/finance-mcp/stdio-server";

describe("Finance MCP STDIO server", () => {
  it("keeps notifications silent and replaces invalid handler responses with internal errors", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const diagnostics = new PassThrough();
    const messages: string[] = [];
    const logs: string[] = [];

    output.on("data", (chunk: Buffer) => messages.push(chunk.toString()));
    diagnostics.on("data", (chunk: Buffer) => logs.push(chunk.toString()));

    const server = runFinanceMcpStdioServer({
      input,
      output,
      diagnostics,
      handleMessage: (message) => {
        if ("id" in message) {
          return createJsonRpcSuccessResponse("wrong-id", { ok: true });
        }

        return undefined;
      },
    });

    input.end(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "test.request" })}\n${JSON.stringify({ jsonrpc: "2.0", method: "test.notification" })}\n`,
    );
    await server;

    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0])).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "Internal error" },
    });
    expect(logs.join("")).toContain("invalid response");
  });
});
