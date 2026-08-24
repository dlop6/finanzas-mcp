import { describe, expect, it, vi } from "vitest";
import type { ChatOrchestrator, OrchestratedChatResult } from "@/host/orchestration/chat-orchestrator";
import { createChatOrchestrator } from "@/host/orchestration/chat-orchestrator";
import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";
import { createSessionChatService } from "@/host/context/session-chat-service";
import { InMemoryConversationSessionStore } from "@/host/context/conversation-session-store";

function completedTurn(answer: string): OrchestratedChatResult {
  return {
    status: "completed",
    response: { content: answer, toolCalls: [], model: "test", finishReason: "stop" },
    turnMessages: [
      { role: "user", content: "Question" },
      { role: "assistant", content: answer },
    ],
  };
}

function serviceWith(
  orchestrator: Pick<ChatOrchestrator, "run"> & Partial<Pick<ChatOrchestrator, "completeConfirmedWrite">>,
) {
  const ids = ["session-a", "session-b"];
  return createSessionChatService({
    sessionStore: new InMemoryConversationSessionStore({ idGenerator: () => ids.shift()! }),
    chatOrchestrator: {
      run: orchestrator.run,
      completeConfirmedWrite: orchestrator.completeConfirmedWrite ?? (async () => {
        throw new Error("Unexpected confirmed write.");
      }),
    },
  });
}

describe("session chat service", () => {
  it("integrates with the real orchestrator and sends prior messages to DeepSeek", async () => {
    const sendChat = vi.fn()
      .mockResolvedValueOnce({ content: "The balance is Q100.00.", toolCalls: [], model: "test", finishReason: "stop" })
      .mockResolvedValueOnce({ content: "You mentioned Q100.00.", toolCalls: [], model: "test", finishReason: "stop" });
    const chat = serviceWith({
      run: createChatOrchestrator({
        deepSeekClient: { sendChat },
        toolRegistry: new HostMcpToolRegistry(),
      }).run,
    });
    const session = chat.createSession({ systemPrompt: "System instruction" });

    await chat.sendMessage(session.sessionId, "My balance is Q100.00.");
    await chat.sendMessage(session.sessionId, "What balance did I mention?");

    expect(sendChat.mock.calls[1][0]).toEqual([
      { role: "system", content: "System instruction" },
      { role: "user", content: "My balance is Q100.00." },
      { role: "assistant", content: "The balance is Q100.00." },
      { role: "user", content: "What balance did I mention?" },
    ]);
  });

  it("sends the prior completed turn as history for the next message", async () => {
    const run = vi.fn<ChatOrchestrator["run"]>()
      .mockResolvedValueOnce(completedTurn("The opening balance is Q100.00."))
      .mockResolvedValueOnce(completedTurn("It is still Q100.00."));
    const chat = serviceWith({ run });
    const session = chat.createSession({ systemPrompt: "System instruction" });

    await chat.sendMessage(session.sessionId, "Remember that the opening balance is Q100.00.");
    await chat.sendMessage(session.sessionId, "What balance did I mention?");

    expect(run.mock.calls[1][0]).toEqual({
      sessionId: "session-a",
      systemPrompt: "System instruction",
      history: [
        { role: "user", content: "Question" },
        { role: "assistant", content: "The opening balance is Q100.00." },
      ],
      userMessage: "What balance did I mention?",
    });
  });

  it("stores complete read tool turns and keeps a write pending outside the history", async () => {
    const run = vi.fn<ChatOrchestrator["run"]>()
      .mockResolvedValueOnce({
        status: "completed",
        response: { content: "Balance is Q100.00.", toolCalls: [], model: "test", finishReason: "stop" },
        turnMessages: [
          { role: "user", content: "Question" },
          { role: "assistant", content: null, toolCalls: [{ id: "read-1", type: "function", function: { name: "get_current_balance", arguments: "{}" } }] },
          { role: "tool", toolCallId: "read-1", content: '{"content":[{"type":"text","text":"Q100.00"}]}' },
          { role: "assistant", content: "Balance is Q100.00." },
        ],
      } satisfies OrchestratedChatResult)
      .mockResolvedValueOnce({
        status: "confirmation_required",
        pendingOperation: {
          toolCallId: "write-1",
          serverId: "finance-mcp",
          toolName: "record_income",
          arguments: { accountId: 1, categoryId: 2, amount: "10.00", date: "2026-08-24" },
        },
        turnMessages: [
          { role: "user", content: "Question" },
          { role: "assistant", content: null, toolCalls: [{ id: "write-1", type: "function", function: { name: "record_income", arguments: '{"accountId":1,"categoryId":2,"amount":"10.00","date":"2026-08-24"}' } }] },
        ],
      } satisfies OrchestratedChatResult);
    const chat = serviceWith({ run });
    const session = chat.createSession({ systemPrompt: "System" });

    await chat.sendMessage(session.sessionId, "Read my balance.");
    const beforePending = chat.getSession(session.sessionId);
    const pending = await chat.sendMessage(session.sessionId, "Record income.");

    expect(pending.status).toBe("confirmation_required");
    expect(chat.getSession(session.sessionId).messages).toEqual(beforePending.messages);
    expect(chat.getSession(session.sessionId).pendingOperation).toMatchObject({
      toolCallId: "write-1",
      serverId: "finance-mcp",
      toolName: "record_income",
      arguments: { accountId: 1, categoryId: 2, amount: "10.00", date: "2026-08-24" },
    });
  });

  it("keeps sessions isolated and leaves history unchanged if orchestration fails", async () => {
    const run = vi.fn<ChatOrchestrator["run"]>()
      .mockResolvedValueOnce(completedTurn("A answer"))
      .mockRejectedValueOnce(new Error("internal failure"));
    const chat = serviceWith({ run });
    const first = chat.createSession({ systemPrompt: "A" });
    const second = chat.createSession({ systemPrompt: "B" });

    await chat.sendMessage(first.sessionId, "First message");
    await expect(chat.sendMessage(second.sessionId, "Second message")).rejects.toThrow("internal failure");

    expect(chat.getSession(first.sessionId).messages).toHaveLength(2);
    expect(chat.getSession(second.sessionId).messages).toEqual([]);
  });

  it("rejects concurrent turns and always releases the session after completion", async () => {
    let resolveFirst: ((result: OrchestratedChatResult) => void) | undefined;
    const run = vi.fn<ChatOrchestrator["run"]>()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(completedTurn("Done"));
    const chat = serviceWith({ run });
    const session = chat.createSession({ systemPrompt: "System" });

    const first = chat.sendMessage(session.sessionId, "First");
    await expect(chat.sendMessage(` ${session.sessionId} `, "Second")).rejects.toMatchObject({ code: "SESSION_BUSY" });
    try {
      chat.closeSession(session.sessionId);
      throw new Error("Expected closeSession to throw.");
    } catch (error) {
      expect(error).toMatchObject({ code: "SESSION_BUSY" });
    }

    resolveFirst?.(completedTurn("First done"));
    await first;
    await expect(chat.sendMessage(session.sessionId, "Second")).resolves.toMatchObject({ status: "completed" });
  });

  it("confirms one stored write once and keeps control input out of the history", async () => {
    const run = vi.fn<ChatOrchestrator["run"]>().mockResolvedValue({
      status: "confirmation_required",
      pendingOperation: {
        toolCallId: "write-1",
        serverId: "finance-mcp",
        toolName: "record_income",
        arguments: { accountId: 1, categoryId: 2, amount: "10.00", date: "2026-08-24" },
      },
      turnMessages: [
        { role: "user", content: "Record income." },
        { role: "assistant", content: null, toolCalls: [{ id: "write-1", type: "function", function: { name: "record_income", arguments: '{"accountId":1,"categoryId":2,"amount":"10.00","date":"2026-08-24"}' } }] },
      ],
    });
    const completeConfirmedWrite = vi.fn<ChatOrchestrator["completeConfirmedWrite"]>().mockResolvedValue({
      status: "completed",
      response: { content: "Income recorded.", toolCalls: [], model: "test", finishReason: "stop" },
      turnMessages: [
        { role: "user", content: "Record income." },
        { role: "assistant", content: null, toolCalls: [{ id: "write-1", type: "function", function: { name: "record_income", arguments: '{"accountId":1,"categoryId":2,"amount":"10.00","date":"2026-08-24"}' } }] },
        { role: "tool", toolCallId: "write-1", content: '{"content":[]}' },
        { role: "assistant", content: "Income recorded." },
      ],
    });
    const chat = serviceWith({ run, completeConfirmedWrite });
    const session = chat.createSession({ systemPrompt: "System" });

    const requested = await chat.sendMessage(session.sessionId, "Record income.");
    const reminder = await chat.sendMessage(session.sessionId, "ok");
    const confirmed = await chat.sendMessage(session.sessionId, "  SÍ ");

    expect(requested).toMatchObject({ status: "confirmation_required", message: expect.stringContaining("¿Confirmas esta operación?") });
    expect(reminder).toMatchObject({ status: "confirmation_required", message: "La operación sigue pendiente. Responde \"sí\" para confirmar o \"no\" para cancelar." });
    expect(confirmed).toMatchObject({ status: "completed", response: { content: "Income recorded." } });
    expect(completeConfirmedWrite).toHaveBeenCalledOnce();
    expect(completeConfirmedWrite.mock.calls[0][0].pendingOperation.arguments).toEqual({ accountId: 1, categoryId: 2, amount: "10.00", date: "2026-08-24" });
    expect(chat.getSession(session.sessionId)).toMatchObject({ pendingOperation: null });
    expect(chat.getSession(session.sessionId).messages).not.toContainEqual({ role: "user", content: "ok" });
    expect(chat.getSession(session.sessionId).messages).not.toContainEqual({ role: "user", content: "SÍ" });
  });

  it("cancels a pending write without completing it", async () => {
    const run = vi.fn<ChatOrchestrator["run"]>().mockResolvedValue({
      status: "confirmation_required",
      pendingOperation: {
        toolCallId: "write-1",
        serverId: "finance-mcp",
        toolName: "delete_transaction",
        arguments: { transactionId: 10 },
      },
      turnMessages: [
        { role: "user", content: "Delete it." },
        { role: "assistant", content: null, toolCalls: [{ id: "write-1", type: "function", function: { name: "delete_transaction", arguments: '{"transactionId":10}' } }] },
      ],
    });
    const completeConfirmedWrite = vi.fn<ChatOrchestrator["completeConfirmedWrite"]>();
    const chat = serviceWith({ run, completeConfirmedWrite });
    const session = chat.createSession({ systemPrompt: "System" });

    await chat.sendMessage(session.sessionId, "Delete it.");
    await expect(chat.sendMessage(session.sessionId, "cancelar")).resolves.toEqual({
      status: "cancelled",
      message: "Operación cancelada.",
    });

    expect(completeConfirmedWrite).not.toHaveBeenCalled();
    expect(chat.getSession(session.sessionId)).toMatchObject({ messages: [], pendingOperation: null });
  });
});
