import { describe, expect, it } from "vitest";
import {
  ConversationSessionError,
  InMemoryConversationSessionStore,
} from "@/host/context/conversation-session-store";

function expectError(action: () => void, code: string): void {
  try {
    action();
    throw new Error("Expected action to throw.");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("in-memory conversation session store", () => {
  it("creates isolated sessions with trimmed system prompts and defensive snapshots", () => {
    const store = new InMemoryConversationSessionStore({
      idGenerator: () => "session-a",
    });

    const created = store.create("  You are a financial assistant.  ");
    expect(created).toEqual({
      sessionId: "session-a",
      systemPrompt: "You are a financial assistant.",
      messages: [],
      conversationSummary: null,
      pendingOperation: null,
    });

    created.messages.push({ role: "user", content: "mutated outside" });
    expect(store.get("session-a").messages).toEqual([]);
  });

  it("preserves completed turn messages chronologically without sharing mutable tool calls", () => {
    const store = new InMemoryConversationSessionStore({ idGenerator: () => "session-a" });
    store.create("System");
    const toolCall = { id: "call-1", type: "function" as const, function: { name: "get_current_balance", arguments: "{}" } };
    const turn = [
      { role: "user" as const, content: "What is my balance?" },
      {
        role: "assistant" as const,
        content: null,
        toolCalls: [toolCall],
      },
      { role: "tool" as const, toolCallId: "call-1", content: '{"content":[]}' },
      { role: "assistant" as const, content: "Your balance is Q19,475.00." },
    ];

    store.appendCompletedTurn("session-a", turn);
    toolCall.function.name = "changed-outside";

    expect(store.get("session-a").messages).toEqual([
      { role: "user", content: "What is my balance?" },
      {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "call-1", type: "function", function: { name: "get_current_balance", arguments: "{}" } }],
      },
      { role: "tool", toolCallId: "call-1", content: '{"content":[]}' },
      { role: "assistant", content: "Your balance is Q19,475.00." },
    ]);
  });

  it("rejects invalid input, collisions, and missing sessions with safe typed errors", () => {
    const store = new InMemoryConversationSessionStore({ idGenerator: () => "same-id" });

    expectError(() => store.create("   "), "INVALID_SYSTEM_PROMPT");
    store.create("System");
    expectError(() => store.create("Another system"), "SESSION_ID_COLLISION");
    expectError(() => store.get("unknown"), "SESSION_NOT_FOUND");
    expectError(() => store.get(" "), "INVALID_SESSION_ID");
    expect(ConversationSessionError).toBeTypeOf("function");
  });

  it("closes sessions permanently and keeps separate sessions isolated", () => {
    const ids = ["session-a", "session-b"];
    const store = new InMemoryConversationSessionStore({ idGenerator: () => ids.shift()! });
    store.create("System A");
    store.create("System B");
    store.appendCompletedTurn("session-a", [{ role: "user", content: "Only A" }]);

    expect(store.get("session-b").messages).toEqual([]);
    store.close("session-a");
    expectError(() => store.get("session-a"), "SESSION_NOT_FOUND");
    expectError(() => store.close("session-a"), "SESSION_NOT_FOUND");
  });

  it("stores one defensive pending confirmation outside the completed history", () => {
    const store = new InMemoryConversationSessionStore({ idGenerator: () => "session-a" });
    store.create("System");
    const pending = {
      operation: {
        toolCallId: "write-1",
        serverId: "finance-mcp",
        toolName: "record_income",
        arguments: { accountId: 1, categoryId: 2, amount: "10.00", date: "2026-08-24" },
      },
      description: "Registrar un ingreso.",
      turnMessages: [
        { role: "user" as const, content: "Registra un ingreso." },
        { role: "assistant" as const, content: null, toolCalls: [{ id: "write-1", type: "function" as const, function: { name: "record_income", arguments: '{"accountId":1,"categoryId":2,"amount":"10.00","date":"2026-08-24"}' } }] },
      ],
    };

    const snapshot = store.setPendingConfirmation("session-a", pending);
    pending.operation.arguments.amount = "999.00";

    expect(snapshot.messages).toEqual([]);
    expect(snapshot.pendingOperation).toMatchObject({
      toolCallId: "write-1",
      arguments: { amount: "10.00" },
    });
    expect(store.getPendingConfirmation("session-a")?.operation.arguments).toMatchObject({ amount: "10.00" });
    expectError(() => store.setPendingConfirmation("session-a", pending), "PENDING_OPERATION_EXISTS");
    expect(store.clearPendingConfirmation("session-a").pendingOperation).toBeNull();
    expectError(() => store.clearPendingConfirmation("session-a"), "PENDING_OPERATION_NOT_FOUND");
  });
});
