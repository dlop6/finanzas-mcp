import { describe, expect, it, vi } from "vitest";
import { ConversationSessionError, type SessionChatService } from "@/host/context";
import { createWebChatHandler } from "@/host/web";

function request(body: unknown, contentType = "application/json"): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function sessionChat(sendMessage?: SessionChatService["sendMessage"], pending = false) {
  const defaultSendMessage: SessionChatService["sendMessage"] = async () => ({
    status: "completed",
    response: { content: "Respuesta general", toolCalls: [], model: "test", finishReason: "stop" },
    turnMessages: [],
  });
  return {
    createSession: vi.fn(() => ({ sessionId: "session-1" })),
    getSession: vi.fn(() => ({
      sessionId: "session-1",
      pendingOperation: pending ? {
        toolCallId: "internal-tool-call-id",
        serverId: "finance-mcp",
        toolName: "record_income",
        arguments: { amount: "1.00" },
        description: "Registrar un ingreso de GTQ 1.00.",
      } : null,
    })),
    sendMessage: vi.fn(sendMessage ?? defaultSendMessage),
  } as unknown as Pick<SessionChatService, "createSession" | "getSession" | "sendMessage">;
}

describe("Web chat API", () => {
  it("creates a session on the first message and reuses it on the next message", async () => {
    const chat = sessionChat();
    const handler = createWebChatHandler(async () => ({ sessionChat: chat }));

    const first = await handler(request({ message: "  Hola  " }));
    const second = await handler(request({ sessionId: "session-1", message: "¿Y ahora?" }));

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "completed", sessionId: "session-1", message: "Respuesta general" });
    expect(second.status).toBe(200);
    expect(chat.createSession).toHaveBeenCalledOnce();
    expect(chat.sendMessage).toHaveBeenNthCalledWith(1, "session-1", "Hola");
    expect(chat.sendMessage).toHaveBeenNthCalledWith(2, "session-1", "¿Y ahora?");
  });

  it("returns a safe pending confirmation without internal tool call IDs", async () => {
    const chat = sessionChat(async () => ({
      status: "confirmation_required" as const,
      message: "¿Confirmas esta operación?",
      pendingOperation: {
        toolCallId: "internal-tool-call-id",
        serverId: "finance-mcp",
        toolName: "record_income",
        arguments: { amount: "1.00" },
        description: "Registrar un ingreso de GTQ 1.00.",
      },
    }));
    const handler = createWebChatHandler(async () => ({ sessionChat: chat }));

    const response = await handler(request({ message: "Registra un ingreso" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "confirmation_required", sessionId: "session-1" });
    expect(JSON.stringify(body)).not.toContain("internal-tool-call-id");
  });

  it("confirms only the pending operation stored by the Host", async () => {
    const chat = sessionChat(undefined, true);
    const handler = createWebChatHandler(async () => ({ sessionChat: chat }));

    const response = await handler(request({ sessionId: "session-1", confirmationDecision: "confirm" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "completed", sessionId: "session-1" });
    expect(chat.getSession).toHaveBeenCalledWith("session-1");
    expect(chat.sendMessage).toHaveBeenCalledWith("session-1", "sí");
    expect(JSON.stringify([...((chat.sendMessage as unknown as { mock: { calls: unknown[] } }).mock.calls)])).not.toContain("record_income");
  });

  it("cancels only the pending operation stored by the Host", async () => {
    const chat = sessionChat(async () => ({ status: "cancelled" as const, message: "Operación cancelada." }), true);
    const handler = createWebChatHandler(async () => ({ sessionChat: chat }));

    const response = await handler(request({ sessionId: "session-1", confirmationDecision: "cancel" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "cancelled", sessionId: "session-1" });
    expect(chat.sendMessage).toHaveBeenCalledWith("session-1", "no");
  });

  it("rejects a decision without a pending operation before DeepSeek or MCP work", async () => {
    const chat = sessionChat();
    const handler = createWebChatHandler(async () => ({ sessionChat: chat }));

    const response = await handler(request({ sessionId: "session-1", confirmationDecision: "confirm" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "CONFIRMATION_NOT_FOUND" } });
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects invalid decision envelopes before starting the Host", async () => {
    const getRuntime = vi.fn();
    const handler = createWebChatHandler(getRuntime);

    for (const invalid of [
      request({ sessionId: "session-1", confirmationDecision: "confirm", message: "sí" }),
      request({ confirmationDecision: "confirm" }),
      request({ sessionId: "session-1", confirmationDecision: "later" }),
      request({ sessionId: "session-1", confirmationDecision: "confirm", arguments: { amount: "1.00" } }),
    ]) {
      const response = await handler(invalid);
      expect(response.status).toBe(400);
    }
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it("rejects malformed, oversized, and non-JSON requests before starting the Host", async () => {
    const getRuntime = vi.fn();
    const handler = createWebChatHandler(getRuntime);

    for (const invalid of [
      request({ message: "", ignored: true }),
      request({ message: "x".repeat(4001) }),
      request("{", "application/json"),
      request({ message: "hola" }, "text/plain"),
    ]) {
      const response = await handler(invalid);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    }
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it("maps missing and busy sessions to safe HTTP errors", async () => {
    const missing = sessionChat(async () => { throw new ConversationSessionError("SESSION_NOT_FOUND", "internal"); });
    const busy = sessionChat(async () => { throw new ConversationSessionError("SESSION_BUSY", "internal"); });

    const missingResponse = await createWebChatHandler(async () => ({ sessionChat: missing }))(request({ sessionId: "gone", message: "hola" }));
    const busyResponse = await createWebChatHandler(async () => ({ sessionChat: busy }))(request({ sessionId: "busy", message: "hola" }));

    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toMatchObject({ error: { code: "SESSION_NOT_FOUND" } });
    expect(busyResponse.status).toBe(409);
    expect(await busyResponse.json()).toMatchObject({ error: { code: "SESSION_BUSY" } });
  });
});
