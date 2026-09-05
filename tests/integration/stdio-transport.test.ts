import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StdioJsonRpcClient,
  StdioTransportError,
} from "@/host/mcp-clients/stdio-jsonrpc-client";
import { startFinanceMcpLocal } from "@/host/mcp-clients/finance-mcp-local";
import { startFinanceMcpSessionLocal } from "@/host/mcp-clients/finance-mcp-local";
import { startFilesystemMcpSessionLocal } from "@/host/mcp-clients/filesystem-mcp-local";
import { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
import {
  HOST_MCP_LOG_SESSION_ID,
  InMemoryMcpInteractionLogStore,
  INVALID_MCP_PAYLOAD,
} from "@/host/mcp-clients/mcp-interaction-log";
import { registerFinanceMcpTools } from "@/host/orchestration/finance-mcp-tools";
import { registerFilesystemMcpTools } from "@/host/orchestration/filesystem-mcp-tools";
import { HostMcpToolRegistry, type McpToolClient } from "@/host/orchestration/mcp-tool-registry";
import { createChatOrchestrator } from "@/host/orchestration/chat-orchestrator";
import { createSessionChatService } from "@/host/context/session-chat-service";
import { InMemoryConversationSessionStore } from "@/host/context/conversation-session-store";
import type { McpTool } from "@/shared/mcp";

const projectRoot = process.cwd();
const require = createRequire(import.meta.url);
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

function systemEnvironment(): NodeJS.ProcessEnv {
  const keys = process.platform === "win32"
    ? ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP"]
    : ["PATH", "TMPDIR", "LANG", "LC_ALL"];
  return Object.fromEntries(keys.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]])) as NodeJS.ProcessEnv;
}

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
});

describe("local MCP STDIO transport", () => {
  it("completes the MCP initialize handshake and becomes ready", async () => {
    const client = await startFinanceMcpSessionLocal({ onStderr: () => undefined });

    try {
      expect(client.state).toBe("READY");
      await expect(client.toolsList()).resolves.toMatchObject({
        tools: [
          { name: "record_income" }, { name: "record_expense" }, { name: "record_transactions_batch" }, { name: "list_transactions" }, { name: "update_transaction" }, { name: "delete_transaction" },
          { name: "record_debt" }, { name: "list_debts" }, { name: "update_debt" }, { name: "mark_debt_paid" }, { name: "delete_debt" },
          { name: "record_receivable" }, { name: "list_receivables" }, { name: "update_receivable" }, { name: "mark_receivable_collected" }, { name: "delete_receivable" },
          { name: "create_product" }, { name: "list_products" }, { name: "update_product" }, { name: "record_inventory_movement" }, { name: "list_low_stock_products" },
          { name: "get_current_balance" }, { name: "get_cash_flow_summary" },
          { name: "project_cash_flow" },
          { name: "evaluate_purchase_viability" },
          { name: "get_transaction_reference_data" },
        ],
      });
    } finally {
      await client.close();
    }
  }, 10_000);

  it("records lifecycle and discovery under the reserved HOST session", async () => {
    const logs = new InMemoryMcpInteractionLogStore();
    const client = await startFinanceMcpSessionLocal({
      onStderr: () => undefined,
      interactionLogger: logs,
    });

    try {
      await client.toolsList();
      const hostLogs = logs.listBySession(HOST_MCP_LOG_SESSION_ID);
      expect(hostLogs).toContainEqual(expect.objectContaining({
        direction: "HOST_TO_MCP", messageType: "request", method: "initialize", status: "SENT", serverId: "finance-mcp",
      }));
      expect(hostLogs).toContainEqual(expect.objectContaining({
        direction: "HOST_TO_MCP", messageType: "notification", method: "notifications/initialized", status: "SENT",
      }));
      expect(hostLogs).toContainEqual(expect.objectContaining({
        direction: "HOST_TO_MCP", messageType: "request", method: "tools/list", status: "SENT",
      }));
      expect(hostLogs).toContainEqual(expect.objectContaining({
        direction: "MCP_TO_HOST", messageType: "response", method: "tools/list", status: "SUCCEEDED",
      }));
    } finally {
      await client.close();
    }
  }, 10_000);

  it("discovers all Finance MCP tools and converts their public definitions for DeepSeek", async () => {
    const session = await startFinanceMcpSessionLocal({ onStderr: () => undefined });
    let discovered: McpTool[] = [];
    const toolClient: McpToolClient = {
      toolsList: async () => {
        const result = await session.toolsList();
        discovered = result.tools;
        return result;
      },
      toolsCall: session.toolsCall.bind(session),
    };

    try {
      const registry = new HostMcpToolRegistry();
      await registerFinanceMcpTools(registry, toolClient);

      const registered = registry.list();
      expect(registered).toHaveLength(26);
      expect(registered.filter((tool) => tool.isWriteOperation)).toHaveLength(16);
      expect(registered.filter((tool) => !tool.isWriteOperation)).toHaveLength(10);
      expect(registered.every((tool) => tool.serverId === "finance-mcp")).toBe(true);
      expect(registered.map((tool) => tool.definition)).toEqual(discovered);
      expect(registry.toDeepSeekTools()).toEqual(
        discovered.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      );
    } finally {
      await session.close();
    }
  });

  it("starts the official Filesystem MCP inside docs/generated and registers its complete catalog", async () => {
    const logs = new InMemoryMcpInteractionLogStore();
    const session = await startFilesystemMcpSessionLocal({ onStderr: () => undefined, interactionLogger: logs });
    try {
      const registry = new HostMcpToolRegistry();
      await registerFilesystemMcpTools(registry, {
        toolsList: session.toolsList.bind(session),
        toolsCall: session.toolsCall.bind(session),
      });
      expect(registry.list()).toHaveLength(14);
      expect(registry.list().filter((tool) => tool.isWriteOperation)).toHaveLength(4);
      await expect(session.toolsCall("read_text_file", { path: resolve(projectRoot, "docs/generated/.gitkeep") })).resolves.toMatchObject({ content: [{ type: "text" }] });
      await expect(session.toolsCall("read_text_file", { path: resolve(projectRoot, "README.md") })).resolves.toMatchObject({ isError: true });
      expect(logs.listBySession(HOST_MCP_LOG_SESSION_ID)).toContainEqual(expect.objectContaining({ serverId: "filesystem-mcp", method: "tools/list" }));
    } finally {
      await session.close();
    }
  }, 15_000);

  it("executes a confirmed filesystem write exactly once through the official MCP process", async () => {
    const allowedDirectory = await mkdtemp(join(tmpdir(), "finance-mcp-filesystem-"));
    const outputPath = join(allowedDirectory, "report.md");
    await writeFile(join(allowedDirectory, "source.md"), "# Source\n", "utf8");
    const logs = new InMemoryMcpInteractionLogStore();
    const transport = new StdioJsonRpcClient({
      command: process.execPath,
      args: [require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js"), allowedDirectory],
      cwd: projectRoot,
      env: systemEnvironment(),
      onStderr: () => undefined,
      serverId: "filesystem-mcp",
      interactionLogger: logs,
    });
    const client = new McpLifecycleClient(transport);
    await transport.start();
    await client.initialize();

    const registry = new HostMcpToolRegistry();
    await registerFilesystemMcpTools(registry, { toolsList: client.toolsList.bind(client), toolsCall: client.toolsCall.bind(client) });
    const sendChat = vi.fn()
      .mockResolvedValueOnce({ content: null, toolCalls: [{ id: "write-1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: outputPath, content: "# Generated\n" }) } }], model: "test", finishReason: "tool_calls" })
      .mockResolvedValueOnce({ content: "The Markdown report was created.", toolCalls: [], model: "test", finishReason: "stop" });
    const chat = createSessionChatService({
      sessionStore: new InMemoryConversationSessionStore({ idGenerator: () => "filesystem-session" }),
      chatOrchestrator: createChatOrchestrator({ deepSeekClient: { sendChat }, toolRegistry: registry }),
      contextCompactor: { compactIfNeeded: async (input) => ({ compacted: false, conversationSummary: input.conversationSummary, messages: Array.from(structuredClone(input.messages)) }) },
    });
    const session = chat.createSession({ systemPrompt: "Use the filesystem tools." });

    try {
      const requested = await chat.sendMessage(session.sessionId, "Create the report.");
      expect(requested).toMatchObject({ status: "confirmation_required", pendingOperation: { toolName: "write_file" } });
      await expect(readFile(outputPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(chat.sendMessage(session.sessionId, "sí")).resolves.toMatchObject({ status: "completed" });
      await expect(readFile(outputPath, "utf8")).resolves.toBe("# Generated\n");
      expect(logs.listBySession("filesystem-session")).toContainEqual(expect.objectContaining({ serverId: "filesystem-mcp", method: "tools/call", status: "SENT" }));
      expect(sendChat).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
      await rm(allowedDirectory, { recursive: true, force: true });
    }
  }, 15_000);

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

  it("records exact correlated JSON-RPC traffic by session", async () => {
    const logs = new InMemoryMcpInteractionLogStore();
    const client = new StdioJsonRpcClient({
      command: process.execPath,
      args: ["--import", "tsx", fixturePath],
      cwd: projectRoot,
      env: process.env,
      serverId: "fixture-mcp",
      interactionLogger: logs,
    });
    clients.push(client);
    await client.start();

    await expect(client.request<string>("test/echo", { value: "hello" }, { sessionId: "session-a" })).resolves.toBe("hello");
    await client.notify("notifications/initialized");

    const sessionLogs = logs.listBySession("session-a");
    expect(sessionLogs).toHaveLength(2);
    expect(sessionLogs[0]).toMatchObject({
      direction: "HOST_TO_MCP", messageType: "request", method: "test/echo", requestId: 1,
      payload: '{"jsonrpc":"2.0","id":1,"method":"test/echo","params":{"value":"hello"}}', status: "SENT", serverId: "fixture-mcp",
    });
    expect(sessionLogs[1]).toMatchObject({
      direction: "MCP_TO_HOST", messageType: "response", method: "test/echo", requestId: 1,
      payload: '{"jsonrpc":"2.0","id":1,"result":"hello"}', status: "SUCCEEDED",
    });
    expect(sessionLogs[1].durationMs).toBeGreaterThanOrEqual(0);
    expect(logs.listBySession(HOST_MCP_LOG_SESSION_ID)).toContainEqual(expect.objectContaining({
      messageType: "notification", method: "notifications/initialized", status: "SENT",
    }));
  });

  it("preserves the origin request when malformed stdout fails the protocol", async () => {
    const logs = new InMemoryMcpInteractionLogStore();
    const client = new StdioJsonRpcClient({
      command: process.execPath,
      args: ["--import", "tsx", fixturePath],
      cwd: projectRoot,
      env: process.env,
      serverId: "fixture-mcp",
      interactionLogger: logs,
    });
    clients.push(client);
    await client.start();

    await expect(client.request("test/invalid-json", undefined, { sessionId: "session-a" })).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });

    expect(logs.listBySession("session-a")).toContainEqual(expect.objectContaining({
      direction: "HOST_TO_MCP", messageType: "request", method: "test/invalid-json", status: "SENT",
    }));
    expect(logs.listBySession("session-a")).toContainEqual(expect.objectContaining({
      direction: "HOST_TO_MCP", messageType: "error", method: "test/invalid-json", status: "PROTOCOL_ERROR",
    }));
    expect(logs.listBySession(HOST_MCP_LOG_SESSION_ID)).toContainEqual(expect.objectContaining({
      direction: "MCP_TO_HOST", messageType: "error", payload: INVALID_MCP_PAYLOAD, status: "PROTOCOL_ERROR",
    }));
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
