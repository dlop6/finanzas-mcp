import type { ChatOrchestrator, OrchestratedChatResult } from "@/host/orchestration/chat-orchestrator";
import {
  ConversationSessionError,
  type ConversationSessionSnapshot,
  type ConversationSessionStore,
  type CreateSessionInput,
  type SessionId,
} from "./conversation-session-store";

export type SessionChatService = {
  createSession(input: CreateSessionInput): ConversationSessionSnapshot;
  getSession(sessionId: SessionId): ConversationSessionSnapshot;
  sendMessage(sessionId: SessionId, userMessage: string): Promise<OrchestratedChatResult>;
  closeSession(sessionId: SessionId): void;
};

export type CreateSessionChatServiceOptions = {
  sessionStore: ConversationSessionStore;
  chatOrchestrator: ChatOrchestrator;
};

function requireUserMessage(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConversationSessionError("INVALID_USER_MESSAGE", "The user message must contain text.");
  }
  return value.trim();
}

export function createSessionChatService(options: CreateSessionChatServiceOptions): SessionChatService {
  const busySessionIds = new Set<SessionId>();

  return {
    createSession(input) {
      return options.sessionStore.create(input.systemPrompt);
    },

    getSession(sessionId) {
      return options.sessionStore.get(sessionId);
    },

    async sendMessage(sessionId, userMessage) {
      const session = options.sessionStore.get(sessionId);
      const normalizedSessionId = session.sessionId;
      const normalizedUserMessage = requireUserMessage(userMessage);
      if (busySessionIds.has(normalizedSessionId)) {
        throw new ConversationSessionError("SESSION_BUSY", "The conversation session is processing another message.");
      }

      busySessionIds.add(normalizedSessionId);
      try {
        const result = await options.chatOrchestrator.run({
          systemPrompt: session.systemPrompt,
          history: session.messages,
          userMessage: normalizedUserMessage,
        });

        if (result.status === "completed") {
          options.sessionStore.appendCompletedTurn(normalizedSessionId, result.turnMessages);
        }

        return structuredClone(result);
      } finally {
        busySessionIds.delete(normalizedSessionId);
      }
    },

    closeSession(sessionId) {
      const session = options.sessionStore.get(sessionId);
      if (busySessionIds.has(session.sessionId)) {
        throw new ConversationSessionError("SESSION_BUSY", "The conversation session is processing another message.");
      }
      options.sessionStore.close(session.sessionId);
    },
  };
}
