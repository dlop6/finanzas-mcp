import {
  ConversationSessionError,
  type PendingWriteConfirmationSnapshot,
  type SessionChatService,
} from "@/host/context";
import { ChatOrchestrationError } from "@/host/orchestration/chat-orchestrator";
import { createWebHostSystemPrompt } from "./web-host-runtime";
import type { TransactionBatchPreview } from "@/host/confirmation/finance-write-describer";

export const WEB_CHAT_MESSAGE_MAX_LENGTH = 4_000;

export type WebChatRequest =
  | {
      sessionId?: string;
      message: string;
    }
  | {
      sessionId: string;
      confirmationDecision: "confirm" | "cancel";
    };

export type WebChatResponse =
  | { status: "completed"; sessionId: string; message: string }
  | { status: "confirmation_resolved"; sessionId: string; outcome: "succeeded" | "rejected" | "unknown"; message: string }
  | {
      status: "confirmation_required";
      sessionId: string;
      message: string;
      pendingOperation: {
        serverId: string;
        toolName: string;
      arguments: Record<string, unknown>;
      description: string;
      preview?: TransactionBatchPreview;
      };
    }
  | { status: "cancelled"; sessionId: string; message: string };

export type WebChatErrorCode =
  | "INVALID_REQUEST"
  | "SESSION_NOT_FOUND"
  | "SESSION_BUSY"
  | "CONFIRMATION_NOT_FOUND"
  | "WRITE_BATCH_PREPARATION_FAILED"
  | "WRITE_BATCH_LIMIT_EXCEEDED"
  | "WRITE_REFERENCE_FAILED"
  | "HOST_UNAVAILABLE"
  | "CHAT_FAILED";

export type WebChatErrorResponse = {
  error: { code: WebChatErrorCode; message: string };
  sessionId?: string;
};

export type WebChatRuntimeProvider = () => Promise<{
  sessionChat: Pick<SessionChatService, "createSession" | "getSession" | "sendMessage">;
}>;

class WebChatRequestError extends Error {}

function errorResponse(code: WebChatErrorCode, status: number, sessionId?: string): Response {
  const message: Record<WebChatErrorCode, string> = {
    INVALID_REQUEST: "La solicitud del chat no es válida.",
    SESSION_NOT_FOUND: "La sesión ya no está disponible. Envía un nuevo mensaje para iniciar otra.",
    SESSION_BUSY: "La sesión todavía está procesando un mensaje.",
    CONFIRMATION_NOT_FOUND: "La operación ya no está pendiente. Verifica el estado antes de continuar.",
    WRITE_BATCH_PREPARATION_FAILED: "No se pudo preparar el conjunto de movimientos. No se realizó ninguna operación.",
    WRITE_BATCH_LIMIT_EXCEEDED: "El lote supera el máximo de 25 movimientos.",
    WRITE_REFERENCE_FAILED: "Una cuenta o categoría ya no está disponible.",
    HOST_UNAVAILABLE: "El servicio de chat no está disponible en este momento.",
    CHAT_FAILED: "No fue posible completar la respuesta del chat.",
  };
  const body: WebChatErrorResponse = {
    error: { code, message: message[code] },
    ...(sessionId ? { sessionId } : {}),
  };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new WebChatRequestError();
  return value as Record<string, unknown>;
}

function parseRequest(value: unknown): WebChatRequest {
  const record = requireObject(value);
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "sessionId" && key !== "message" && key !== "confirmationDecision")) throw new WebChatRequestError();

  const hasMessage = Object.hasOwn(record, "message");
  const hasDecision = Object.hasOwn(record, "confirmationDecision");
  if (hasMessage === hasDecision) throw new WebChatRequestError();

  if (hasDecision) {
    if (typeof record.sessionId !== "string" || !record.sessionId.trim()) throw new WebChatRequestError();
    if (record.confirmationDecision !== "confirm" && record.confirmationDecision !== "cancel") throw new WebChatRequestError();
    return { sessionId: record.sessionId.trim(), confirmationDecision: record.confirmationDecision };
  }

  if (typeof record.message !== "string") throw new WebChatRequestError();
  const message = record.message.trim();
  if (!message || message.length > WEB_CHAT_MESSAGE_MAX_LENGTH) throw new WebChatRequestError();

  if (record.sessionId === undefined) return { message };
  if (typeof record.sessionId !== "string" || !record.sessionId.trim()) throw new WebChatRequestError();
  return { sessionId: record.sessionId.trim(), message };
}

function isConfirmationDecision(input: WebChatRequest): input is Extract<WebChatRequest, { confirmationDecision: "confirm" | "cancel" }> {
  return "confirmationDecision" in input;
}

async function parseHttpRequest(request: Request): Promise<WebChatRequest> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) throw new WebChatRequestError();
  try {
    return parseRequest(await request.json());
  } catch (error) {
    if (error instanceof WebChatRequestError) throw error;
    throw new WebChatRequestError();
  }
}

function pendingOperation(snapshot: PendingWriteConfirmationSnapshot): Extract<WebChatResponse, { status: "confirmation_required" }>["pendingOperation"] {
  return {
    serverId: snapshot.serverId,
    toolName: snapshot.toolName,
    arguments: structuredClone(snapshot.arguments),
    description: snapshot.description,
    ...(snapshot.preview ? { preview: structuredClone(snapshot.preview) } : {}),
  };
}

function toResponse(result: Awaited<ReturnType<SessionChatService["sendMessage"]>>, sessionId: string): WebChatResponse {
  if (result.status === "completed") {
    if (!result.response.content?.trim()) throw new Error("Missing completed response content.");
    if (result.writeOutcome) return { status: "confirmation_resolved", sessionId, outcome: result.writeOutcome, message: result.response.content };
    return { status: "completed", sessionId, message: result.response.content };
  }
  if (result.status === "confirmation_required") {
    return {
      status: "confirmation_required",
      sessionId,
      message: result.message,
      pendingOperation: pendingOperation(result.pendingOperation),
    };
  }
  return { status: "cancelled", sessionId, message: result.message };
}

export function createWebChatHandler(getRuntime: WebChatRuntimeProvider): (request: Request) => Promise<Response> {
  return async (request) => {
    let input: WebChatRequest;
    try {
      input = await parseHttpRequest(request);
    } catch {
      return errorResponse("INVALID_REQUEST", 400);
    }

    let runtime: Awaited<ReturnType<WebChatRuntimeProvider>>;
    try {
      runtime = await getRuntime();
    } catch {
      return errorResponse("HOST_UNAVAILABLE", 503, input.sessionId);
    }

    let sessionId = input.sessionId;
    try {
      if (isConfirmationDecision(input)) {
        const decisionSessionId = input.sessionId;
        const session = runtime.sessionChat.getSession(decisionSessionId);
        if (!session.pendingOperation) return errorResponse("CONFIRMATION_NOT_FOUND", 409, decisionSessionId);
        // The browser sends only a decision; SessionChatService retrieves the stored operation and never trusts client-supplied tool arguments.
        const decisionMessage = input.confirmationDecision === "confirm" ? "sí" : "no";
        const result = await runtime.sessionChat.sendMessage(decisionSessionId, decisionMessage);
        return Response.json(toResponse(result, decisionSessionId), { headers: { "Cache-Control": "no-store" } });
      }
      if (!sessionId) {
        sessionId = runtime.sessionChat.createSession({ systemPrompt: createWebHostSystemPrompt() }).sessionId;
      }
      const result = await runtime.sessionChat.sendMessage(sessionId, input.message);
      return Response.json(toResponse(result, sessionId), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof ConversationSessionError) {
        if (error.code === "SESSION_NOT_FOUND") return errorResponse("SESSION_NOT_FOUND", 404, sessionId);
        if (error.code === "SESSION_BUSY") return errorResponse("SESSION_BUSY", 409, sessionId);
        if (error.code === "PENDING_OPERATION_NOT_FOUND") return errorResponse("CONFIRMATION_NOT_FOUND", 409, sessionId);
        if (error.code === "INVALID_USER_MESSAGE") return errorResponse("INVALID_REQUEST", 400, sessionId);
      }
      if (error instanceof ChatOrchestrationError) {
        if (error.code === "UNSUPPORTED_WRITE_BATCH") return errorResponse("WRITE_BATCH_PREPARATION_FAILED", 422, sessionId);
        if (error.code === "INVALID_TOOL_ARGUMENTS") return errorResponse("WRITE_BATCH_PREPARATION_FAILED", 422, sessionId);
      }
      return errorResponse("CHAT_FAILED", 502, sessionId);
    }
  };
}
