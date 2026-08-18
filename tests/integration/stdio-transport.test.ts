import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  StdioJsonRpcClient,
  StdioTransportError,
} from "@/host/mcp-clients/stdio-jsonrpc-client";
import { startFinanceMcpLocal } from "@/host/mcp-clients/finance-mcp-local";
import { startFinanceMcpSessionLocal } from "@/host/mcp-clients/finance-mcp-local";
import { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";

const projectRoot = process.cwd();
const fixturePath = resolve(projectRoot, "tests/integration/fixtures/stdio-fixture.ts");
const financeServerPath = resolve(projectRoot, "servers/finance-mcp/stdio.ts");
const financeToolsFixturePath = resolve(projectRoot, "tests/integration/fixtures/finance-tools-fixture.ts");
const clients: StdioJsonRpcClient[] = [];

function fixtureClient(onStderr?: (text: string) => void): StdioJsonRpcClient {
  return new StdioJsonRpcClient({
    command: process.execPath,
    args: ["--import", "tsx", fixturePath],
    cwd: projectRoot,
    env: process.env,
    onStderr,
  });
}

async function startFixture(onStderr?: (text: string) => void): Promise<StdioJsonRpcClient> {
  const client = fixtureClient(onStderr);
  clients.push(client);
  await client.start();
  return client;
}

async function readLine(stream: ChildProcessWithoutNullStreams["stdout"]): Promise<string> {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const [line] = (await once(lines, "line")) as [string];
  lines.close();
  return line;
}

function startRawFinanceServer(): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["--import", "tsx", financeServerPath], {
    cwd: projectRoot,
    env: process.env,
    shell: false,
    stdio: "pipe",
  });
}

async function closeRawServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  const closed = once(child, "close");
  child.stdin.end();
  await closed;
}

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
});

describe("local MCP STDIO transport", () => {
  it("completes the MCP initialize handshake and becomes ready", async () => {
    const client = await startFinanceMcpSessionLocal({ onStderr: () => undefined });

    try {
      expect(client.state).toBe("READY");
      await expect(client.toolsList()).resolves.toEqual({ tools: [] });
    } finally {
      await client.close();
    }
  });

  it("discovers and calls a test-only tool over a real STDIO session", async () => {
    const transport = new StdioJsonRpcClient({
      command: process.execPath,
      args: ["--import", "tsx", financeToolsFixturePath],
      cwd: projectRoot,
      env: process.env,
    });
    const client = new McpLifecycleClient(transport);

    await transport.start();
    await client.initialize();
    try {
      await expect(client.toolsList()).resolves.toEqual({
        tools: [{
          name: "test.echo",
          description: "Returns the provided test message.",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
            additionalProperties: false,
          },
        }],
      });
      await expect(client.toolsCall("test.echo", { message: "hello" })).resolves.toEqual({
        content: [{ type: "text", text: "hello" }],
      });
      await expect(client.toolsCall("test.echo", {})).resolves.toMatchObject({ isError: true });
      await expect(client.toolsCall("missing.tool")).rejects.toMatchObject({ code: -32602 });
    } finally {
      await client.close();
    }
  });

  it("starts the real Finance MCP and returns a JSON-RPC method-not-found error", async () => {
    const client = await startFinanceMcpLocal({ onStderr: () => undefined });
    clients.push(client);

    await expect(client.request("unknown.method")).rejects.toMatchObject({
      name: "JsonRpcRemoteError",
      code: -32601,
      message: "Method not found",
    });
  });

  it("associates concurrent responses with their original request IDs", async () => {
    const client = await startFixture();

    const first = client.request<string>("test/echo", { value: "first", delayMs: 30 });
    const second = client.request<string>("test/echo", { value: "second", delayMs: 0 });

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
  });

  it("keeps server diagnostics out of the JSON-RPC stdout stream", async () => {
    const diagnostics: string[] = [];
    const client = await startFixture((text) => diagnostics.push(text));

    await expect(client.request<string>("test/stderr")).resolves.toBe("ok");
    await expect.poll(() => diagnostics.join("")).toContain("fixture diagnostic");
  });

  it("rejects pending requests when the Finance MCP process exits", async () => {
    const client = await startFixture();

    await expect(client.request("test/crash")).rejects.toBeInstanceOf(StdioTransportError);
  });

  it("fails fast when stdout is not valid JSON-RPC", async () => {
    const client = await startFixture();

    await expect(client.request("test/invalid-json")).rejects.toMatchObject({
      code: "PROTOCOL_ERROR",
    });
  });

  it("fails fast when a response ID is not pending", async () => {
    const client = await startFixture();

    await expect(client.request("test/unknown-id")).rejects.toMatchObject({
      code: "PROTOCOL_ERROR",
    });
  });

  it("rejects calls outside the active lifecycle and closes idempotently", async () => {
    const client = fixtureClient();
    clients.push(client);

    await expect(client.request("test/echo")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await client.start();
    await client.start();
    await client.close();
    await client.close();
    await expect(client.request("test/echo")).rejects.toMatchObject({
      code: "CLOSED",
    });
  });

  it("returns standard parser and envelope errors from the real server", async () => {
    const malformedServer = startRawFinanceServer();

    try {
      malformedServer.stdin.write("{\n");
      const malformedResponse = JSON.parse(await readLine(malformedServer.stdout)) as { error: { code: number }; id: null };
      expect(malformedResponse.error.code).toBe(-32700);
      expect(malformedResponse.id).toBeNull();
    } finally {
      await closeRawServer(malformedServer);
    }

    const invalidServer = startRawFinanceServer();

    try {
      invalidServer.stdin.write(`${JSON.stringify({ method: "missing.envelope" })}\n`);
      const invalidResponse = JSON.parse(await readLine(invalidServer.stdout)) as { error: { code: number } };
      expect(invalidResponse.error.code).toBe(-32600);
    } finally {
      await closeRawServer(invalidServer);
    }
  });
});
