import { describe, expect, it, vi } from "vitest";
import type { DeepSeekChatResult, DeepSeekClient } from "@/host/llm";
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
): Promise<HostMcpToolRegistry> {
  const registry = new HostMcpToolRegistry();
  await registry.registerServer({
    serverId: "test-mcp",
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
    expect(deepSeek.sendChat.mock.calls[1][1]).toBeUndefined();
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

  it("rejects a final response that requests another tool round", async () => {
    const client = toolClient();
    const registry = await registryWith([readTool], client);
    const deepSeek = llm(
      response({ toolCalls: [{ id: "call-1", type: "function", function: { name: "read_balance", arguments: "{}" } }] }),
      response({ toolCalls: [{ id: "call-2", type: "function", function: { name: "read_balance", arguments: "{}" } }] }),
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
