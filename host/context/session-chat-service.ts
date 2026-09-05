import type { ChatOrchestrator, OrchestratedChatResult } from "@/host/orchestration/chat-orchestrator";
import {
  cancelledMessage,
  classifyConfirmationInput,
  confirmationReminderMessage,
  confirmationRequiredMessage,
  HostWriteOperationDescriber,
  type WriteOperationDescriber,
} from "@/host/confirmation";
import type { WriteOperationPresentation } from "@/host/confirmation/finance-write-describer";
import {
  ConversationSessionError,
  type ConversationSessionSnapshot,
  type ConversationSessionStore,
  type CreateSessionInput,
  type PendingWriteConfirmationSnapshot,
  type SessionId,
} from "./conversation-session-store";
import { formatConversationSummary, type ContextCompactor } from "./context-compactor";

export type SessionChatResult =
  | Extract<OrchestratedChatResult, { status: "completed" }>
  | { status: "confirmation_required"; pendingOperation: PendingWriteConfirmationSnapshot; message: string }
  | { status: "cancelled"; message: string };

export type SessionChatService = {
  createSession(input: CreateSessionInput): ConversationSessionSnapshot;
  getSession(sessionId: SessionId): ConversationSessionSnapshot;
  sendMessage(sessionId: SessionId, userMessage: string): Promise<SessionChatResult>;
  closeSession(sessionId: SessionId): void;
};

export type CreateSessionChatServiceOptions = {
  sessionStore: ConversationSessionStore;
  chatOrchestrator: ChatOrchestrator;
  writeOperationDescriber?: WriteOperationDescriber;
  contextCompactor: ContextCompactor;
};

function requireUserMessage(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConversationSessionError("INVALID_USER_MESSAGE", "The user message must contain text.");
  }
  return value.trim();
}

function presentation(value: string | WriteOperationPresentation): WriteOperationPresentation {
  return typeof value === "string" ? { description: value } : structuredClone(value);
}

export function createSessionChatService(options: CreateSessionChatServiceOptions): SessionChatService {
  const busySessionIds = new Set<SessionId>();
  const writeOperationDescriber = options.writeOperationDescriber ?? new HostWriteOperationDescriber();

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
      if (busySessionIds.has(normalizedSessionId)) {
        throw new ConversationSessionError("SESSION_BUSY", "The conversation session is processing another message.");
      }

      busySessionIds.add(normalizedSessionId);
      try {
        const pending = options.sessionStore.getPendingConfirmation(normalizedSessionId);
        if (pending) {
          const decision = classifyConfirmationInput(userMessage);
          if (decision === "cancel") {
            options.sessionStore.clearPendingConfirmation(normalizedSessionId);
            return { status: "cancelled", message: cancelledMessage() };
          }
          if (decision === "other") {
            return {
              status: "confirmation_required",
              pendingOperation: options.sessionStore.get(normalizedSessionId).pendingOperation!,
              message: confirmationReminderMessage(),
            };
          }

          // The pending operation was produced by the Host, not by this follow-up message; clearing it first prevents a second execution.
          options.sessionStore.clearPendingConfirmation(normalizedSessionId);
          const completed = await options.chatOrchestrator.completeConfirmedWrite({
            sessionId: normalizedSessionId,
            systemPrompt: session.systemPrompt,
            contextSummary: formatConversationSummary(session.conversationSummary),
            history: session.messages,
            pendingOperation: pending.operation,
            pendingTurnMessages: pending.turnMessages,
          });
          options.sessionStore.appendCompletedTurn(normalizedSessionId, completed.turnMessages);
          return structuredClone(completed);
        }

        const normalizedUserMessage = requireUserMessage(userMessage);
        let context = {
          conversationSummary: session.conversationSummary,
          messages: session.messages,
        };
        try {
          const compacted = await options.contextCompactor.compactIfNeeded(context);
          if (compacted.compacted && compacted.conversationSummary) {
            const snapshot = options.sessionStore.applyCompaction(normalizedSessionId, compacted.conversationSummary, compacted.messages);
            context = { conversationSummary: snapshot.conversationSummary, messages: snapshot.messages };
          }
        } catch {
          // Preserve the current context when DeepSeek cannot summarize it.
        }
        const result = await options.chatOrchestrator.run({
          sessionId: normalizedSessionId,
          systemPrompt: session.systemPrompt,
          contextSummary: formatConversationSummary(context.conversationSummary),
          history: context.messages,
          userMessage: normalizedUserMessage,
        });

        if (result.status === "confirmation_required") {
          const described = presentation(await writeOperationDescriber.describe(result.pendingOperation, { sessionId: normalizedSessionId }));
          // Keep the exact proposed tool call outside the model history until the session receives an explicit decision.
          const snapshot = options.sessionStore.setPendingConfirmation(normalizedSessionId, {
            operation: result.pendingOperation,
            description: described.description,
            ...(described.preview ? { preview: described.preview } : {}),
            turnMessages: result.turnMessages,
          });
          return {
            status: "confirmation_required",
            pendingOperation: snapshot.pendingOperation!,
            message: confirmationRequiredMessage(described.description),
          };
        }

        options.sessionStore.appendCompletedTurn(normalizedSessionId, result.turnMessages);
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
