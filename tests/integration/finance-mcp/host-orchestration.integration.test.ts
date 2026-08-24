import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { createChatOrchestrator } from "@/host/orchestration/chat-orchestrator";
import { createSessionChatService } from "@/host/context/session-chat-service";
import { InMemoryConversationSessionStore } from "@/host/context/conversation-session-store";
import { registerFinanceMcpTools } from "@/host/orchestration/finance-mcp-tools";
import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";
import { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
import { StdioJsonRpcClient } from "@/host/mcp-clients/stdio-jsonrpc-client";
import { getValidatedTestDatabaseUrl } from "@/database/test/test-database-config";
import { resetFinanceTestDatabase } from "./fixtures";
import { createTestPrisma } from "./test-prisma";

const prisma = createTestPrisma();
const projectRoot = process.cwd();
const financeServerPath = resolve(projectRoot, "servers/finance-mcp/stdio.ts");

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetFinanceTestDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Host orchestration over Finance MCP STDIO", () => {
  it("runs a read tool through lifecycle and gives its result to the final LLM call", async () => {
    const transport = new StdioJsonRpcClient({
      command: process.execPath,
      args: ["--import", "tsx", financeServerPath],
      cwd: projectRoot,
      env: { DATABASE_URL: getValidatedTestDatabaseUrl(), NODE_ENV: "test" },
      onStderr: () => undefined,
    });
    const lifecycle = new McpLifecycleClient(transport);
    await transport.start();
    await lifecycle.initialize();

    try {
      const registry = new HostMcpToolRegistry();
      await registerFinanceMcpTools(registry, lifecycle);
      const sendChat = vi.fn()
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [{ id: "balance-1", type: "function", function: { name: "get_current_balance", arguments: "{}" } }],
          model: "test-model",
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({ content: "The current balance is Q19,475.00.", toolCalls: [], model: "test-model", finishReason: "stop" });

      const result = await createChatOrchestrator({ deepSeekClient: { sendChat }, toolRegistry: registry }).run({
        systemPrompt: "Use financial tools when required.",
        history: [],
        userMessage: "What is my current balance?",
      });

      expect(result).toMatchObject({ status: "completed", response: { content: "The current balance is Q19,475.00." } });
      expect(sendChat).toHaveBeenCalledTimes(2);
      expect(sendChat.mock.calls[1][0]).toContainEqual({
        role: "tool",
        toolCallId: "balance-1",
        content: expect.stringContaining("19475.00"),
      });
    } finally {
      await lifecycle.close();
    }
  });

  it("does not write until a session explicitly confirms the exact pending operation", async () => {
    const transport = new StdioJsonRpcClient({
      command: process.execPath,
      args: ["--import", "tsx", financeServerPath],
      cwd: projectRoot,
      env: { DATABASE_URL: getValidatedTestDatabaseUrl(), NODE_ENV: "test" },
      onStderr: () => undefined,
    });
    const lifecycle = new McpLifecycleClient(transport);
    await transport.start();
    await lifecycle.initialize();

    try {
      const registry = new HostMcpToolRegistry();
      await registerFinanceMcpTools(registry, lifecycle);
      const transactionCount = await prisma.transaction.count();
      const sendChat = vi.fn()
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [{
            id: "income-1",
            type: "function",
            function: {
              name: "record_income",
              arguments: '{"accountId":1,"categoryId":1,"amount":"10.00","date":"2026-08-08","description":"Integration confirmation"}',
            },
          }],
          model: "test-model",
          finishReason: "tool_calls",
        })
        .mockResolvedValueOnce({ content: "Income recorded.", toolCalls: [], model: "test-model", finishReason: "stop" });
      const chat = createSessionChatService({
        sessionStore: new InMemoryConversationSessionStore({ idGenerator: () => "confirmation-session" }),
        chatOrchestrator: createChatOrchestrator({ deepSeekClient: { sendChat }, toolRegistry: registry }),
      });
      const session = chat.createSession({ systemPrompt: "Use financial tools when required." });

      await expect(chat.sendMessage(session.sessionId, "Record Q10.00 of income.")).resolves.toMatchObject({
        status: "confirmation_required",
      });
      expect(await prisma.transaction.count()).toBe(transactionCount);

      await expect(chat.sendMessage(session.sessionId, "ok")).resolves.toMatchObject({
        status: "confirmation_required",
      });
      expect(await prisma.transaction.count()).toBe(transactionCount);

      await expect(chat.sendMessage(session.sessionId, "sí")).resolves.toMatchObject({
        status: "completed",
        response: { content: "Income recorded." },
      });
      expect(await prisma.transaction.count()).toBe(transactionCount + 1);
      await expect(prisma.transaction.findFirst({
        where: { description: "Integration confirmation" },
        select: { accountId: true, categoryId: true, amount: true, date: true },
      })).resolves.toMatchObject({
        accountId: 1,
        categoryId: 1,
        amount: expect.objectContaining({}),
        date: new Date("2026-08-08T00:00:00.000Z"),
      });
      expect(sendChat).toHaveBeenCalledTimes(2);
    } finally {
      await lifecycle.close();
    }
  });
});
