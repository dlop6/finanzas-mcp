"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import AssistantMarkdown from "./assistant-markdown";
import WriteConfirmationCard, { type ConfirmationState, type PendingOperationView } from "./write-confirmation-card";
import styles from "./chat-client.module.css";

type ConfirmationMessage = { id: number; role: "assistant"; format: "plain"; kind: "confirmation"; text: string; operation: PendingOperationView; confirmationState: ConfirmationState; stateMessage?: string };
type UserMessage = { id: number; role: "user"; format: "plain"; text: string; delivery?: "failed" };
type ChatMessage = UserMessage | { id: number; role: "assistant"; format: "markdown" | "plain"; kind: "model" | "control"; text: string } | ConfirmationMessage;
type NewChatMessage =
  | { role: "user"; format: "plain"; text: string }
  | { role: "assistant"; format: "markdown" | "plain"; kind: "model" | "control"; text: string }
  | Omit<ConfirmationMessage, "id">;
type ChatRequestState = "idle" | "sending_message" | "confirming" | "cancelling";
type ApiSuccess =
  | { status: "completed"; sessionId: string; message: string }
  | { status: "confirmation_resolved"; sessionId: string; outcome: "succeeded" | "rejected" | "unknown"; message: string }
  | { status: "confirmation_required"; sessionId: string; message: string; pendingOperation: PendingOperationView }
  | { status: "cancelled"; sessionId: string; message: string };
type ApiError = { error: { code: string; message: string }; sessionId?: string };

function isTransactionPreview(value: unknown): value is PendingOperationView["preview"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const preview = value as Record<string, unknown>;
  const items = preview.items;
  const validItems = Array.isArray(items) && items.every((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
      const row = item as Record<string, unknown>;
      return typeof row.accountName === "string" && typeof row.categoryName === "string"
        && typeof row.amount === "string" && typeof row.date === "string"
        && (row.description === undefined || typeof row.description === "string");
    });
  if (!validItems || preview.currency !== "GTQ") return false;
  if (preview.kind === "transaction_batch") return preview.transactionType === "INCOME" || preview.transactionType === "EXPENSE";
  return preview.kind === "mixed_transaction_batch" && items.every((item) => {
    const row = item as Record<string, unknown>;
    return row.type === "INCOME" || row.type === "EXPENSE";
  });
}

function isPendingOperation(value: unknown): value is PendingOperationView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const operation = value as Record<string, unknown>;
  return typeof operation.serverId === "string" && typeof operation.toolName === "string" && typeof operation.description === "string" && typeof operation.arguments === "object" && operation.arguments !== null && !Array.isArray(operation.arguments)
    && (operation.preview === undefined || isTransactionPreview(operation.preview));
}

function isApiSuccess(value: unknown): value is ApiSuccess {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Record<string, unknown>;
  if (typeof response.sessionId !== "string" || typeof response.message !== "string") return false;
  if (response.status === "completed" || response.status === "cancelled") return true;
  if (response.status === "confirmation_resolved") return response.outcome === "succeeded" || response.outcome === "rejected" || response.outcome === "unknown";
  return response.status === "confirmation_required" && isPendingOperation(response.pendingOperation);
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Record<string, unknown>;
  return typeof response.error === "object" && response.error !== null && typeof (response.error as Record<string, unknown>).code === "string" && typeof (response.error as Record<string, unknown>).message === "string";
}

function isConfirmationMessage(message: ChatMessage): message is ConfirmationMessage {
  return message.role === "assistant" && "kind" in message && message.kind === "confirmation";
}

export default function ChatClient({ embedded = false, onSessionIdChange }: { embedded?: boolean; onSessionIdChange?: (sessionId: string | null) => void }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<ChatRequestState>("idle");
  const [requestDelayed, setRequestDelayed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextMessageId = useRef(1);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const requestInFlight = useRef(false);
  const restoreComposerFocus = useRef(false);
  const activeConfirmation = messages.find((message) => isConfirmationMessage(message) && ["pending", "confirming", "cancelling"].includes(message.confirmationState));
  const composerBlocked = Boolean(activeConfirmation);

  useEffect(() => {
    if (restoreComposerFocus.current && !composerBlocked && status === "idle") {
      composerRef.current?.focus();
      restoreComposerFocus.current = false;
    }
  }, [composerBlocked, status]);

  useEffect(() => {
    if (status !== "sending_message") return;
    const timer = window.setTimeout(() => setRequestDelayed(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const addMessage = (message: NewChatMessage) => {
    const id = nextMessageId.current++;
    const nextMessage: ChatMessage = { id, ...message } as ChatMessage;
    setMessages((current) => [...current, nextMessage]);
    return id;
  };

  const markUserMessageFailed = (id: number) => setMessages((current) => current.map((message) => message.role === "user" && message.id === id ? { ...message, delivery: "failed" } : message));

  const updateConfirmation = (id: number, update: Partial<Pick<ConfirmationMessage, "confirmationState" | "text" | "operation" | "stateMessage">>) => {
    setMessages((current) => current.map((message) => isConfirmationMessage(message) && message.id === id ? { ...message, ...update, operation: update.operation ? structuredClone(update.operation) : message.operation } : message));
  };

  const parseResponse = async (response: Response): Promise<ApiSuccess> => {
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error("El servidor devolvió una respuesta no válida."); }
    if (isApiSuccess(body) && response.ok) return body;
    if (isApiError(body)) {
      if (body.error.code === "SESSION_NOT_FOUND") { setSessionId(null); onSessionIdChange?.(null); }
      const safeError = new Error(body.error.message) as Error & { code?: string };
      safeError.code = body.error.code;
      throw safeError;
    }
    throw new Error("No fue posible completar la respuesta del chat.");
  };

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (requestInFlight.current || status !== "idle" || composerBlocked) return;
    const message = draft.trim();
    if (!message) return;
    setError(null);
    setRequestDelayed(false);
    requestInFlight.current = true;
    setStatus("sending_message");
    const submittedMessageId = addMessage({ role: "user", format: "plain", text: message });
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(sessionId ? { sessionId } : {}), message }) });
      const body = await parseResponse(response);
      setSessionId(body.sessionId);
      onSessionIdChange?.(body.sessionId);
      setDraft("");
      if (body.status === "completed") addMessage({ role: "assistant", format: "markdown", kind: "model", text: body.message });
      else if (body.status === "confirmation_required") addMessage({ role: "assistant", format: "plain", kind: "confirmation", text: body.message, operation: structuredClone(body.pendingOperation), confirmationState: "pending" });
      else addMessage({ role: "assistant", format: "plain", kind: "control", text: body.message });
    } catch (caught) {
      markUserMessageFailed(submittedMessageId);
      restoreComposerFocus.current = true;
      setError(caught instanceof Error ? caught.message : "No fue posible completar la respuesta del chat.");
    } finally { requestInFlight.current = false; setRequestDelayed(false); setStatus("idle"); }
  };

  const decide = async (message: ConfirmationMessage, decision: "confirm" | "cancel") => {
    if (!sessionId || requestInFlight.current || status !== "idle" || message.confirmationState !== "pending") return;
    setError(null);
    requestInFlight.current = true;
    setStatus(decision === "confirm" ? "confirming" : "cancelling");
    updateConfirmation(message.id, { confirmationState: decision === "confirm" ? "confirming" : "cancelling", stateMessage: undefined });
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, confirmationDecision: decision }) });
      const body = await parseResponse(response);
      setSessionId(body.sessionId);
      onSessionIdChange?.(body.sessionId);
      if (body.status === "completed") { updateConfirmation(message.id, { confirmationState: "confirmed" }); addMessage({ role: "assistant", format: "markdown", kind: "model", text: body.message }); restoreComposerFocus.current = true; }
      else if (body.status === "confirmation_resolved") {
        const confirmationState: ConfirmationState = body.outcome === "succeeded" ? "confirmed" : body.outcome;
        updateConfirmation(message.id, { confirmationState, stateMessage: body.outcome === "succeeded" ? undefined : body.message });
        if (body.outcome === "succeeded") addMessage({ role: "assistant", format: "markdown", kind: "model", text: body.message });
        restoreComposerFocus.current = true;
      }
      else if (body.status === "cancelled") { updateConfirmation(message.id, { confirmationState: "cancelled" }); restoreComposerFocus.current = true; }
      else updateConfirmation(message.id, { confirmationState: "pending", text: body.message, operation: structuredClone(body.pendingOperation) });
    } catch (caught) {
      const safeError: Error & { code?: string } = caught instanceof Error
        ? caught as Error & { code?: string }
        : new Error("No fue posible resolver la operación.");
      if (safeError.code === "CONFIRMATION_NOT_FOUND" || safeError.code === "SESSION_NOT_FOUND") { updateConfirmation(message.id, { confirmationState: "error", stateMessage: safeError.message }); restoreComposerFocus.current = true; }
      else updateConfirmation(message.id, { confirmationState: "pending", stateMessage: safeError.message });
    } finally { requestInFlight.current = false; setStatus("idle"); }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
  };

  const content = <>
    {!embedded ? <header className={styles.header}><p className={styles.eyebrow}>FINANCE MCP</p><h1 className={styles.title}>Asistente financiero</h1><p className={styles.subtitle}>Consulta información de tu negocio o haz una pregunta general. Las operaciones de escritura requieren confirmación.</p></header> : null}
    <section className={styles.conversation} aria-label="Conversación">
      {messages.length === 0 ? <div className={styles.emptyState}><p>Escribe una pregunta para iniciar la conversación.</p></div> : <ol className={styles.messages}>
        {messages.map((message) => <li key={message.id} className={`${styles.messageRow} ${message.role === "user" ? styles.messageRowUser : styles.messageRowAssistant}`}>
          {isConfirmationMessage(message) ? <WriteConfirmationCard messageId={message.id} operation={message.operation} state={message.confirmationState} stateMessage={message.stateMessage} onDecision={(decision) => void decide(message, decision)} /> : <article aria-live={message.role === "assistant" ? "polite" : undefined} className={`${styles.message} ${message.role === "user" ? styles.messageUser : message.kind === "control" ? styles.messageControl : styles.messageAssistant}`}><p className={styles.messageLabel}>{message.role === "user" ? "Tú" : message.kind === "control" ? "Confirmación" : "Asistente"}</p>{message.format === "markdown" ? <AssistantMarkdown content={message.text} /> : <p className={styles.plainText}>{message.text}</p>}{message.role === "user" && message.delivery === "failed" ? <p className={styles.failedMessageNote} role="status">No procesado. <button type="button" onClick={() => { setDraft(message.text); composerRef.current?.focus(); }}>Editar mensaje</button></p> : null}</article>}
        </li>)}
        {status === "sending_message" ? <li className={`${styles.messageRow} ${styles.messageRowAssistant}`}><article className={`${styles.message} ${styles.messageAssistant} ${styles.loadingMessage}`} role="status" aria-live="polite" aria-atomic="true"><p className={styles.messageLabel}>Asistente</p><p className={styles.loadingTitle}>Procesando tu solicitud…</p><p className={styles.loadingDescription}>{requestDelayed ? "La solicitud sigue en curso. Algunas consultas pueden tardar más de lo habitual." : "El asistente está preparando la respuesta y puede consultar herramientas."}</p><div className={styles.loadingSkeleton} data-testid="chat-loading-skeleton" aria-hidden="true"><span /><span /><span /></div></article></li> : null}
      </ol>}
    </section>
    <form className={styles.composer} onSubmit={submit}>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <label className="sr-only" htmlFor="chat-message">Mensaje</label>
      <textarea ref={composerRef} id="chat-message" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} disabled={status !== "idle" || composerBlocked} maxLength={4000} rows={3} placeholder="Escribe tu mensaje…" className={styles.textarea} />
      <div className={styles.composerFooter}><p className={styles.hint}>{composerBlocked ? "Resuelve la operación pendiente para continuar." : status === "sending_message" ? "Espera mientras se completa la respuesta." : "Enter para enviar · Shift+Enter para una nueva línea"}</p><button type="submit" disabled={status !== "idle" || composerBlocked || !draft.trim()} className={styles.sendButton}>{status === "sending_message" ? "Procesando…" : "Enviar"}</button></div>
    </form>
  </>;
  if (embedded) return content;
  return <main className={styles.page}><div className={styles.shell}>{content}</div></main>;
}
