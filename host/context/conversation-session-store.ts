import type { DeepSeekChatMessage, DeepSeekToolCall } from "@/host/llm";

export type SessionId = string;

export type ConversationSessionSnapshot = {
  sessionId: SessionId;
  systemPrompt: string;
  messages: DeepSeekChatMessage[];
};

export type CreateSessionInput = {
  systemPrompt: string;
};

export type ConversationSessionErrorCode =
  | "INVALID_SYSTEM_PROMPT"
  | "INVALID_SESSION_ID"
  | "SESSION_NOT_FOUND"
  | "SESSION_ID_COLLISION"
  | "SESSION_BUSY"
  | "INVALID_USER_MESSAGE"
  | "INVALID_TURN_MESSAGES";

export class ConversationSessionError extends Error {
  constructor(
    public readonly code: ConversationSessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConversationSessionError";
  }
}

type ConversationSession = {
  systemPrompt: string;
  messages: DeepSeekChatMessage[];
};

export type ConversationSessionStore = {
  create(systemPrompt: string): ConversationSessionSnapshot;
  get(sessionId: SessionId): ConversationSessionSnapshot;
  appendCompletedTurn(sessionId: SessionId, messages: readonly DeepSeekChatMessage[]): ConversationSessionSnapshot;
  close(sessionId: SessionId): void;
};

export type InMemoryConversationSessionStoreOptions = {
  idGenerator?: () => string;
};

function requireText(value: unknown, code: ConversationSessionErrorCode, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConversationSessionError(code, message);
  }
  return value.trim();
}

function cloneMessage(message: DeepSeekChatMessage): DeepSeekChatMessage {
  return structuredClone(message);
}

function isToolCall(value: unknown): value is DeepSeekToolCall {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const toolCall = value as Record<string, unknown>;
  if (toolCall.type !== "function" || typeof toolCall.id !== "string" || toolCall.id.trim().length === 0) {
    return false;
  }

  if (typeof toolCall.function !== "object" || toolCall.function === null) {
    return false;
  }

  const functionCall = toolCall.function as Record<string, unknown>;
  return (
    typeof functionCall.name === "string" &&
    functionCall.name.trim().length > 0 &&
    typeof functionCall.arguments === "string"
  );
}

function isCompletedTurnMessage(value: unknown): value is DeepSeekChatMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as Record<string, unknown>;
  if (message.role === "user") {
    return typeof message.content === "string" && message.content.trim().length > 0;
  }
  if (message.role === "tool") {
    return (
      typeof message.toolCallId === "string" &&
      message.toolCallId.trim().length > 0 &&
      typeof message.content === "string" &&
      message.content.trim().length > 0
    );
  }
  if (message.role !== "assistant") {
    return false;
  }

  const hasContent = typeof message.content === "string" && message.content.trim().length > 0;
  const toolCalls = message.toolCalls;
  const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0 && toolCalls.every(isToolCall);
  return (message.content === null || hasContent) && (hasContent || hasToolCalls);
}

export class InMemoryConversationSessionStore implements ConversationSessionStore {
  private readonly sessions = new Map<SessionId, ConversationSession>();
  private readonly idGenerator: () => string;

  constructor(options: InMemoryConversationSessionStoreOptions = {}) {
    this.idGenerator = options.idGenerator ?? crypto.randomUUID;
  }

  create(systemPrompt: string): ConversationSessionSnapshot {
    const normalizedSystemPrompt = requireText(systemPrompt, "INVALID_SYSTEM_PROMPT", "The system prompt must contain text.");
    const sessionId = requireText(this.idGenerator(), "SESSION_ID_COLLISION", "The generated session ID is invalid.");
    if (this.sessions.has(sessionId)) {
      throw new ConversationSessionError("SESSION_ID_COLLISION", "The generated session ID already exists.");
    }

    const session: ConversationSession = { systemPrompt: normalizedSystemPrompt, messages: [] };
    this.sessions.set(sessionId, session);
    return this.toSnapshot(sessionId, session);
  }

  get(sessionId: SessionId): ConversationSessionSnapshot {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const session = this.requireSession(normalizedSessionId);
    return this.toSnapshot(normalizedSessionId, session);
  }

  appendCompletedTurn(sessionId: SessionId, messages: readonly DeepSeekChatMessage[]): ConversationSessionSnapshot {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const session = this.requireSession(normalizedSessionId);
    if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isCompletedTurnMessage)) {
      throw new ConversationSessionError("INVALID_TURN_MESSAGES", "Completed turn messages are invalid.");
    }

    session.messages.push(...messages.map(cloneMessage));
    return this.toSnapshot(normalizedSessionId, session);
  }

  close(sessionId: SessionId): void {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    this.requireSession(normalizedSessionId);
    this.sessions.delete(normalizedSessionId);
  }

  private normalizeSessionId(sessionId: SessionId): SessionId {
    return requireText(sessionId, "INVALID_SESSION_ID", "The session ID must contain text.");
  }

  private requireSession(sessionId: SessionId): ConversationSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new ConversationSessionError("SESSION_NOT_FOUND", "The conversation session does not exist.");
    }
    return session;
  }

  private toSnapshot(sessionId: SessionId, session: ConversationSession): ConversationSessionSnapshot {
    return {
      sessionId,
      systemPrompt: session.systemPrompt,
      messages: session.messages.map(cloneMessage),
    };
  }
}
