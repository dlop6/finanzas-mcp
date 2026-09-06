import { describe, expect, it, vi } from "vitest";
import type { DeepSeekChatMessage, DeepSeekChatResult, DeepSeekClient } from "@/host/llm";
import { createChatOrchestrator } from "@/host/orchestration/chat-orchestrator";
import {
  HostMcpToolRegistry,
  type McpToolClient,
} from "@/host/orchestration/mcp-tool-registry";
import type { McpTool } from "@/shared/mcp";
import type { McpCallToolResult } from "@/shared/mcp";

const readTool: McpTool = {
  name: "read_balance",
  description: "Returns the current balance.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
};

const secondReadTool: McpTool = {
  name: "list_transactions",
  description: "Lists transactions.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
};

const writeTool: McpTool = {
  name: "record_income",
  description: "Records an income.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
};

const batchWriteTool: McpTool = {
  name: "record_transactions_batch",
  description: "Records a batch.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
};

const mixedBatchWriteTool: McpTool = {
  name: "record_mixed_transactions_batch",
  description: "Records a mixed batch.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
};

const quoteSaleTool: McpTool = { name: "quote_sale", description: "Quotes a sale.", inputSchema: { type: "object", additionalProperties: false, properties: {} } };
const recordSaleTool: McpTool = { name: "record_sale", description: "Records a sale.", inputSchema: { type: "object", additionalProperties: false, properties: {} } };

function response(overrides: Partial<DeepSeekChatResult> = {}): DeepSeekChatResult {
  return {
    content: "Final answer.",
    toolCalls: [],
    model: "test-model",
    finishReason: "stop",
    ...overrides,
  };
}

async function registryWith(
  tools: McpTool[],
  client: McpToolClient,
  writes: readonly string[] = [],
  serverId = "test-mcp",
): Promise<HostMcpToolRegistry> {
  const registry = new HostMcpToolRegistry();
  await registry.registerServer({
    serverId,
    client: { ...client, toolsList: vi.fn(async () => ({ tools })) },
    metadata: Object.fromEntries(tools.map((tool) => [tool.name, { isWriteOperation: writes.includes(tool.name) }])),
  });
  return registry;
}

function toolClient(result: McpCallToolResult = { content: [{ type: "text", text: "ok" }] }): McpToolClient {
  return {
    toolsList: vi.fn(async () => ({ tools: [] })),
    toolsCall: vi.fn(async () => result),
  };
}

function llm(...responses: DeepSeekChatResult[]): Pick<DeepSeekClient, "sendChat"> & { sendChat: ReturnType<typeof vi.fn> } {
  return { sendChat: vi.fn(async () => responses.shift() ?? response()) } as Pick<DeepSeekClient, "sendChat"> & {
    sendChat: ReturnType<typeof vi.fn>;
  };
}

const input = {
  sessionId: "session-a",
  systemPrompt: "You are a financial assistant.",
  history: [{ role: "assistant" as const, content: "Previous answer." }],
  userMessage: "What is my balance?",
};

describe("chat orchestration", () => {
  it("returns a direct model response without calling MCP", async () => {
    const client = toolClient();
    const registry = await registryWith([readTool], client);
    const deepSeek = llm(response({ content: "Direct answer." }));

    await expect(createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input)).resolves.toMatchObject({
      status: "completed",
      response: { content: "Direct answer." },
      turnMessages: [
        { role: "user", content: input.userMessage },
        { role: "assistant", content: "Direct answer." },
      ],
    });
    expect(client.toolsCall).not.toHaveBeenCalled();
    expect(deepSeek.sendChat).toHaveBeenCalledOnce();
  });

  it("rejects an empty session ID before calling the model", async () => {
    const client = toolClient();
    const registry = await registryWith([readTool], client);
    const deepSeek = llm(response({ content: "Unused." }));

    await expect(createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run({
      ...input,
      sessionId: "   ",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(deepSeek.sendChat).not.toHaveBeenCalled();
  });

  it("executes a read call through its owner and sends its result to one final LLM call", async () => {
    const client = toolClient({ content: [{ type: "text", text: "19475.00" }], structuredContent: { amount: "19475.00" } });
    const registry = await registryWith([readTool], client);
    const deepSeek = llm(
      response({
        content: null,
        toolCalls: [{ id: "call-1", type: "function", function: { name: "read_balance", arguments: "{}" } }],
      }),
      response({ content: "Your balance is Q19,475.00." }),
    );

    const result = await createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input);

    expect(result).toMatchObject({ status: "completed", response: { content: "Your balance is Q19,475.00." } });
    expect(client.toolsCall).toHaveBeenCalledWith("read_balance", {}, { sessionId: "session-a" });
    expect(deepSeek.sendChat).toHaveBeenCalledTimes(2);
    expect(deepSeek.sendChat.mock.calls[1][1]).toEqual(expect.any(Array));
    expect(deepSeek.sendChat.mock.calls[1][0]).toContainEqual({
      role: "tool",
      toolCallId: "call-1",
      content: JSON.stringify({ content: [{ type: "text", text: "19475.00" }], structuredContent: { amount: "19475.00" } }),
    });
  });

  it("executes multiple read calls sequentially and continues after an MCP failure", async () => {
    const execution: string[] = [];
    const client: McpToolClient = {
      toolsList: vi.fn(async () => ({ tools: [] })),
      toolsCall: vi.fn(async (name: string) => {
        execution.push(name);
        if (name === "read_balance") {
          throw new Error("transport detail must not be exposed");
        }
        return { content: [{ type: "text" as const, text: "transactions" }] };
      }),
    };
    const registry = await registryWith([readTool, secondReadTool], client);
    const deepSeek = llm(
      response({
        toolCalls: [
          { id: "call-1", type: "function", function: { name: "read_balance", arguments: "{}" } },
          { id: "call-2", type: "function", function: { name: "list_transactions", arguments: "{}" } },
        ],
      }),
      response(),
    );

    await createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input);

    expect(execution).toEqual(["read_balance", "list_transactions"]);
    const secondMessages = deepSeek.sendChat.mock.calls[1][0];
    expect(secondMessages).toContainEqual({
      role: "tool",
      toolCallId: "call-1",
      content: expect.stringContaining("MCP tool execution failed."),
    });
    expect(secondMessages).toContainEqual({
      role: "tool",
      toolCallId: "call-2",
      content: JSON.stringify({ content: [{ type: "text", text: "transactions" }] }),
    });
  });

  it.each([
    ["unknown tool", "unknown_tool", "{}", "UNKNOWN_TOOL"],
    ["invalid JSON", "read_balance", "{", "INVALID_TOOL_ARGUMENTS"],
    ["array arguments", "read_balance", "[]", "INVALID_TOOL_ARGUMENTS"],
  ])("rejects %s before executing any MCP tool", async (_label, name, argumentsJson, code) => {
    const client = toolClient();
    const registry = await registryWith([readTool], client);
    const deepSeek = llm(response({
      toolCalls: [{ id: "call-1", type: "function", function: { name, arguments: argumentsJson } }],
    }));

    await expect(createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input)).rejects.toMatchObject({ code });
    expect(client.toolsCall).not.toHaveBeenCalled();
  });

  it("rejects duplicate tool-call IDs before executing any MCP tool", async () => {
    const client = toolClient();
    const registry = await registryWith([readTool], client);
    const deepSeek = llm(response({
      toolCalls: [
        { id: "same", type: "function", function: { name: "read_balance", arguments: "{}" } },
        { id: "same", type: "function", function: { name: "read_balance", arguments: "{}" } },
      ],
    }));

    await expect(createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input)).rejects.toMatchObject({
      code: "INVALID_TOOL_CALL",
    });
    expect(client.toolsCall).not.toHaveBeenCalled();
  });

  it("returns one isolated write as a pending confirmation without executing MCP", async () => {
    const client = toolClient();
    const registry = await registryWith([writeTool], client, ["record_income"]);
    const deepSeek = llm(response({
      toolCalls: [{ id: "write-1", type: "function", function: { name: "record_income", arguments: '{"amount":"10.00"}' } }],
    }));

    const result = await createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input);

    expect(result).toMatchObject({
      status: "confirmation_required",
      pendingOperation: {
        toolCallId: "write-1",
        serverId: "test-mcp",
        toolName: "record_income",
        arguments: { amount: "10.00" },
      },
    });
    expect(client.toolsCall).not.toHaveBeenCalled();
    expect(deepSeek.sendChat).toHaveBeenCalledOnce();
  });

  it("rejects write batches before executing any call", async () => {
    const client = toolClient();
    const registry = await registryWith([readTool, writeTool], client, ["record_income"]);
    const deepSeek = llm(response({
      toolCalls: [
        { id: "read-1", type: "function", function: { name: "read_balance", arguments: "{}" } },
        { id: "write-1", type: "function", function: { name: "record_income", arguments: "{}" } },
      ],
    }));

    await expect(createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input)).rejects.toMatchObject({
      code: "UNSUPPORTED_WRITE_BATCH",
    });
    expect(client.toolsCall).not.toHaveBeenCalled();
  });

  it("normalizes homogeneous transaction writes into one pending batch", async () => {
    const client = toolClient();
    const registry = await registryWith([writeTool, batchWriteTool], client, ["record_income", "record_transactions_batch"], "finance-mcp");
    const deepSeek = llm(response({
      toolCalls: [
        { id: "one", type: "function", function: { name: "record_income", arguments: '{"accountId":1,"categoryId":1,"amount":"10.00","date":"2026-08-10"}' } },
        { id: "two", type: "function", function: { name: "record_income", arguments: '{"accountId":2,"categoryId":2,"amount":"20.00","date":"2026-08-11"}' } },
      ],
    }));
    const result = await createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input);
    expect(result).toMatchObject({
      status: "confirmation_required",
      pendingOperation: { toolName: "record_transactions_batch", arguments: { type: "INCOME", transactions: [{ amount: "10.00" }, { amount: "20.00" }] } },
    });
    expect(client.toolsCall).not.toHaveBeenCalled();
  });

  it("normalizes mixed transaction writes into one pending atomic batch without executing MCP", async () => {
    const client = toolClient();
    const expenseTool = { ...writeTool, name: "record_expense", description: "Records an expense." };
    const registry = await registryWith([writeTool, expenseTool, batchWriteTool, mixedBatchWriteTool], client, ["record_income", "record_expense", "record_transactions_batch", "record_mixed_transactions_batch"], "finance-mcp");
    const deepSeek = llm(response({
      toolCalls: [
        { id: "income", type: "function", function: { name: "record_income", arguments: '{"accountId":1,"categoryId":1,"amount":"5000.00","date":"2026-09-05"}' } },
        { id: "expense", type: "function", function: { name: "record_expense", arguments: '{"accountId":2,"categoryId":4,"amount":"500.00","date":"2026-09-05"}' } },
      ],
    }));

    await expect(createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input)).resolves.toMatchObject({
      status: "confirmation_required",
      pendingOperation: {
        toolName: "record_mixed_transactions_batch",
        arguments: { transactions: [{ type: "INCOME", amount: "5000.00" }, { type: "EXPENSE", amount: "500.00" }] },
      },
    });
    expect(client.toolsCall).not.toHaveBeenCalled();
  });

  it("normalizes a homogeneous batch and individual expense into one mixed pending batch in source order", async () => {
    const client = toolClient();
    const expenseTool = { ...writeTool, name: "record_expense", description: "Records an expense." };
    const registry = await registryWith([writeTool, expenseTool, batchWriteTool, mixedBatchWriteTool], client, ["record_income", "record_expense", "record_transactions_batch", "record_mixed_transactions_batch"], "finance-mcp");
    const deepSeek = llm(response({
      toolCalls: [
        { id: "incomes", type: "function", function: { name: "record_transactions_batch", arguments: '{"type":"INCOME","transactions":[{"accountId":1,"categoryId":1,"amount":"10.00","date":"2026-09-05"},{"accountId":1,"categoryId":1,"amount":"20.00","date":"2026-09-05"}]}' } },
        { id: "expense", type: "function", function: { name: "record_expense", arguments: '{"accountId":2,"categoryId":4,"amount":"5.00","date":"2026-09-05"}' } },
      ],
    }));

    const result = await createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input);
    expect(result).toMatchObject({ status: "confirmation_required", pendingOperation: { toolName: "record_mixed_transactions_batch" } });
    if (result.status === "confirmation_required") {
      expect(result.pendingOperation.arguments).toEqual({ transactions: [
        { type: "INCOME", accountId: 1, categoryId: 1, amount: "10.00", date: "2026-09-05" },
        { type: "INCOME", accountId: 1, categoryId: 1, amount: "20.00", date: "2026-09-05" },
        { type: "EXPENSE", accountId: 2, categoryId: 4, amount: "5.00", date: "2026-09-05" },
      ] });
    }
    expect(client.toolsCall).not.toHaveBeenCalled();
  });

  it("requires the exact Finance quote before offering a sale confirmation", async () => {
    const recordArguments = { accountId: 1, categoryId: 1, date: "2026-09-06", totalAmount: "75.00", lines: [{ productId: 3, quantity: 10, pricingMode: "CATALOG", catalogUnitPrice: "7.50", amount: "75.00" }] };
    const client = toolClient({ content: [{ type: "text", text: "quoted" }], structuredContent: { recordArguments } });
    const registry = await registryWith([quoteSaleTool, recordSaleTool], client, ["record_sale"], "finance-mcp");
    const deepSeek = llm(
      response({ toolCalls: [{ id: "quote", type: "function", function: { name: "quote_sale", arguments: "{}" } }] }),
      response({ toolCalls: [{ id: "sale", type: "function", function: { name: "record_sale", arguments: JSON.stringify(recordArguments) } }] }),
    );
    await expect(createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input)).resolves.toMatchObject({ status: "confirmation_required", pendingOperation: { toolName: "record_sale", arguments: recordArguments } });
    expect(client.toolsCall).toHaveBeenCalledTimes(1);
  });

  it("preserves a quoted sale across a textual answer and prepares it on the next turn without writing", async () => {
    const args = { accountId: 1, categoryId: 2, totalAmount: "97.00", lines: [{ productId: 1, quantity: 3 }] };
    const client = toolClient({ content: [], structuredContent: { recordArguments: args } });
    const registry = await registryWith([quoteSaleTool, recordSaleTool], client, ["record_sale"], "finance-mcp");
    const deepSeek = llm(
      response({ toolCalls: [{ id: "quote", type: "function", function: { name: "quote_sale", arguments: "{}" } }] }),
      response({ content: "La cotización es GTQ 97.00." }),
      response({ toolCalls: [{ id: "sale", type: "function", function: { name: "record_sale", arguments: JSON.stringify({ lines: args.lines, totalAmount: args.totalAmount, categoryId: 2, accountId: 1 }) } }] }),
    );
    const orchestrator = createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry });
    const quoted = await orchestrator.run(input);
    const pending = await orchestrator.run({ ...input, history: quoted.turnMessages, userMessage: "si confirmo" });
    expect(pending).toMatchObject({ status: "confirmation_required", pendingOperation: { toolName: "record_sale", arguments: args } });
    expect(client.toolsCall).toHaveBeenCalledTimes(1);
    expect(client.toolsCall).toHaveBeenCalledWith("quote_sale", {}, { sessionId: input.sessionId });
    if (pending.status !== "confirmation_required") throw new Error("Expected confirmation");
    await orchestrator.completeConfirmedWrite({ ...input, history: quoted.turnMessages, pendingOperation: pending.pendingOperation, pendingTurnMessages: pending.turnMessages });
    expect(client.toolsCall).toHaveBeenCalledTimes(2);
    expect(client.toolsCall).toHaveBeenLastCalledWith("record_sale", args, { sessionId: input.sessionId });
  });

  it.each(["changed", "failed", "unrelated", "superseded", "consumed", "missing"])("rejects a %s quote without writing", async (scenario) => {
    const args = { totalAmount: "97.00" };
    const history: DeepSeekChatMessage[] = [
      { role: "assistant", content: null, toolCalls: [{ id: "quote", type: "function", function: { name: scenario === "unrelated" ? "read_balance" : "quote_sale", arguments: "{}" } }] },
      { role: "tool", toolCallId: "quote", content: JSON.stringify({ content: [], isError: scenario === "failed", structuredContent: { recordArguments: args } }) },
    ];
    if (scenario === "superseded") history.push({ role: "assistant", content: null, toolCalls: [{ id: "new-quote", type: "function", function: { name: "quote_sale", arguments: "{}" } }] });
    if (scenario === "consumed") history.push({ role: "assistant", content: null, toolCalls: [{ id: "old-sale", type: "function", function: { name: "record_sale", arguments: JSON.stringify(args) } }] });
    const client = toolClient();
    const registry = await registryWith([quoteSaleTool, recordSaleTool, readTool], client, ["record_sale"], "finance-mcp");
    const model = llm(response({ toolCalls: [{ id: "sale", type: "function", function: { name: "record_sale", arguments: JSON.stringify(scenario === "changed" ? { totalAmount: "98.00" } : args) } }] }));
    await expect(createChatOrchestrator({ deepSeekClient: model, toolRegistry: registry }).run({ ...input, history: scenario === "missing" ? [] : history })).rejects.toMatchObject({ code: "SALE_QUOTE_REQUIRED" });
    expect(client.toolsCall).not.toHaveBeenCalled();
  });

  it("rejects an unquoted sale before any write runs", async () => {
    const client = toolClient();
    const registry = await registryWith([recordSaleTool], client, ["record_sale"], "finance-mcp");
    const deepSeek = llm(response({ toolCalls: [{ id: "sale", type: "function", function: { name: "record_sale", arguments: "{}" } }] }));
    await expect(createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input)).rejects.toMatchObject({ code: "SALE_QUOTE_REQUIRED" });
    expect(client.toolsCall).not.toHaveBeenCalled();
  });

  it("rejects a final response that requests another tool round", async () => {
    const client = toolClient();
    const registry = await registryWith([readTool], client);
    const deepSeek = llm(
      response({ toolCalls: [{ id: "call-1", type: "function", function: { name: "read_balance", arguments: "{}" } }] }),
      response({ toolCalls: [{ id: "call-2", type: "function", function: { name: "read_balance", arguments: "{}" } }] }),
      response({ toolCalls: [{ id: "call-3", type: "function", function: { name: "read_balance", arguments: "{}" } }] }),
    );

    await expect(createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry }).run(input)).rejects.toMatchObject({
      code: "TOOL_ROUND_LIMIT",
    });
  });

  it("executes exactly the confirmed write and sends its result to one final LLM call", async () => {
    const client = toolClient({ content: [{ type: "text", text: "Income recorded." }] });
    const registry = await registryWith([writeTool], client, ["record_income"]);
    const deepSeek = llm(response({ content: "The income was recorded." }));
    const orchestrator = createChatOrchestrator({ deepSeekClient: deepSeek, toolRegistry: registry });
    const pendingTurnMessages = [
      { role: "user" as const, content: "Record income." },
      { role: "assistant" as const, content: null, toolCalls: [{ id: "write-1", type: "function" as const, function: { name: "record_income", arguments: '{"amount":"10.00"}' } }] },
    ];

    const result = await orchestrator.completeConfirmedWrite({
      sessionId: "session-a",
      systemPrompt: input.systemPrompt,
      history: input.history,
      pendingOperation: { toolCallId: "write-1", serverId: "test-mcp", toolName: "record_income", arguments: { amount: "10.00" } },
      pendingTurnMessages,
    });

    expect(client.toolsCall).toHaveBeenCalledTimes(1);
    expect(client.toolsCall).toHaveBeenCalledWith("record_income", { amount: "10.00" }, { sessionId: "session-a" });
    expect(deepSeek.sendChat).toHaveBeenCalledTimes(1);
    expect(deepSeek.sendChat.mock.calls[0][1]).toBeUndefined();
    expect(result.turnMessages).toContainEqual({
      role: "tool",
      toolCallId: "write-1",
      content: JSON.stringify({ content: [{ type: "text", text: "Income recorded." }] }),
    });
  });

  it("rejects an altered pending write before executing MCP", async () => {
    const client = toolClient();
    const registry = await registryWith([writeTool], client, ["record_income"]);
    const orchestrator = createChatOrchestrator({ deepSeekClient: llm(), toolRegistry: registry });

    await expect(orchestrator.completeConfirmedWrite({
      sessionId: "session-a",
      systemPrompt: input.systemPrompt,
      history: [],
      pendingOperation: { toolCallId: "write-1", serverId: "test-mcp", toolName: "record_income", arguments: { amount: "20.00" } },
      pendingTurnMessages: [
        { role: "user", content: "Record income." },
        { role: "assistant", content: null, toolCalls: [{ id: "write-1", type: "function", function: { name: "record_income", arguments: '{"amount":"10.00"}' } }] },
      ],
    })).rejects.toMatchObject({ code: "PENDING_OPERATION_MISMATCH" });
    expect(client.toolsCall).not.toHaveBeenCalled();
  });
});
