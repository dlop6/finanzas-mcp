import type { DeepSeekChatMessage, DeepSeekToolCall } from "@/host/llm";
import type { PendingWriteOperation } from "@/host/orchestration/chat-orchestrator";
import type { TransactionBatchPreview } from "@/host/confirmation/finance-write-describer";
import { isConversationSummary, type ConversationSummary } from "./context-compactor";

export type SessionId = string;

export type ConversationSessionSnapshot = {
  sessionId: SessionId;
  systemPrompt: string;
  messages: DeepSeekChatMessage[];
  conversationSummary: ConversationSummary | null;
  pendingOperation: PendingWriteConfirmationSnapshot | null;
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
  | "INVALID_TURN_MESSAGES"
  | "PENDING_OPERATION_EXISTS"
  | "PENDING_OPERATION_NOT_FOUND"
  | "INVALID_PENDING_OPERATION";

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
  conversationSummary: ConversationSummary | null;
  pendingConfirmation: PendingWriteConfirmation | null;
};

export type PendingWriteConfirmation = {
  operation: PendingWriteOperation;
  description: string;
  preview?: TransactionBatchPreview;
  turnMessages: DeepSeekChatMessage[];
};

export type PendingWriteConfirmationSnapshot = {
  toolCallId: string;
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  description: string;
  preview?: TransactionBatchPreview;
};

export type ConversationSessionStore = {
  create(systemPrompt: string): ConversationSessionSnapshot;
  get(sessionId: SessionId): ConversationSessionSnapshot;
  appendCompletedTurn(sessionId: SessionId, messages: readonly DeepSeekChatMessage[]): ConversationSessionSnapshot;
  applyCompaction(sessionId: SessionId, summary: ConversationSummary, retainedMessages: readonly DeepSeekChatMessage[]): ConversationSessionSnapshot;
  setPendingConfirmation(sessionId: SessionId, pending: PendingWriteConfirmation): ConversationSessionSnapshot;
  getPendingConfirmation(sessionId: SessionId): PendingWriteConfirmation | null;
  clearPendingConfirmation(sessionId: SessionId): ConversationSessionSnapshot;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clonePendingConfirmation(pending: PendingWriteConfirmation): PendingWriteConfirmation {
  return structuredClone(pending);
}

function isPendingConfirmation(value: PendingWriteConfirmation): boolean {
  const operation = value?.operation;
  return (
    typeof value?.description === "string" &&
    value.description.trim().length > 0 &&
    Array.isArray(value.turnMessages) &&
    value.turnMessages.length > 0 &&
    value.turnMessages.every(isCompletedTurnMessage) &&
    typeof operation?.toolCallId === "string" &&
    operation.toolCallId.trim().length > 0 &&
    typeof operation.serverId === "string" &&
    operation.serverId.trim().length > 0 &&
    typeof operation.toolName === "string" &&
    operation.toolName.trim().length > 0 &&
    isRecord(operation.arguments)
  );
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

    const session: ConversationSession = { systemPrompt: normalizedSystemPrompt, messages: [], conversationSummary: null, pendingConfirmation: null };
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

  applyCompaction(sessionId: SessionId, summary: ConversationSummary, retainedMessages: readonly DeepSeekChatMessage[]): ConversationSessionSnapshot {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const session = this.requireSession(normalizedSessionId);
    if (!isConversationSummary(summary) || !Array.isArray(retainedMessages) || !retainedMessages.every(isCompletedTurnMessage)) {
      throw new ConversationSessionError("INVALID_TURN_MESSAGES", "Compacted conversation context is invalid.");
    }
    if (retainedMessages.length >= session.messages.length || !retainedMessages.every((message, index) => JSON.stringify(message) === JSON.stringify(session.messages[session.messages.length - retainedMessages.length + index]))) {
      throw new ConversationSessionError("INVALID_TURN_MESSAGES", "Compacted conversation context is invalid.");
    }
    session.conversationSummary = structuredClone(summary);
    session.messages = retainedMessages.map(cloneMessage);
    return this.toSnapshot(normalizedSessionId, session);
  }

  setPendingConfirmation(sessionId: SessionId, pending: PendingWriteConfirmation): ConversationSessionSnapshot {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const session = this.requireSession(normalizedSessionId);
    if (session.pendingConfirmation) {
      throw new ConversationSessionError("PENDING_OPERATION_EXISTS", "The conversation session already has a pending operation.");
    }
    if (!isPendingConfirmation(pending)) {
      throw new ConversationSessionError("INVALID_PENDING_OPERATION", "The pending operation is invalid.");
    }

    session.pendingConfirmation = clonePendingConfirmation(pending);
    return this.toSnapshot(normalizedSessionId, session);
  }

  getPendingConfirmation(sessionId: SessionId): PendingWriteConfirmation | null {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const session = this.requireSession(normalizedSessionId);
    return session.pendingConfirmation ? clonePendingConfirmation(session.pendingConfirmation) : null;
  }

  clearPendingConfirmation(sessionId: SessionId): ConversationSessionSnapshot {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const session = this.requireSession(normalizedSessionId);
    if (!session.pendingConfirmation) {
      throw new ConversationSessionError("PENDING_OPERATION_NOT_FOUND", "The conversation session has no pending operation.");
    }

    session.pendingConfirmation = null;
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
      conversationSummary: session.conversationSummary ? structuredClone(session.conversationSummary) : null,
      pendingOperation: session.pendingConfirmation ? {
        toolCallId: session.pendingConfirmation.operation.toolCallId,
        serverId: session.pendingConfirmation.operation.serverId,
        toolName: session.pendingConfirmation.operation.toolName,
        arguments: structuredClone(session.pendingConfirmation.operation.arguments),
        description: session.pendingConfirmation.description,
        ...(session.pendingConfirmation.preview ? { preview: structuredClone(session.pendingConfirmation.preview) } : {}),
      } : null,
    };
  }
}
