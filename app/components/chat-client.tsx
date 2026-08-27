"use client";

import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import AssistantMarkdown from "./assistant-markdown";
import styles from "./chat-client.module.css";

type ChatMessage =
  | { id: number; role: "user"; format: "plain"; text: string }
  | { id: number; role: "assistant"; format: "markdown" | "plain"; kind: "model" | "control"; text: string };

type NewChatMessage =
  | { role: "user"; format: "plain"; text: string }
  | { role: "assistant"; format: "markdown" | "plain"; kind: "model" | "control"; text: string };

type ApiSuccess =
  | { status: "completed"; sessionId: string; message: string }
  | { status: "confirmation_required"; sessionId: string; message: string }
  | { status: "cancelled"; sessionId: string; message: string };

type ApiError = {
  error: { code: string; message: string };
  sessionId?: string;
};

function isApiSuccess(value: unknown): value is ApiSuccess {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Record<string, unknown>;
  return (
    (response.status === "completed" || response.status === "confirmation_required" || response.status === "cancelled")
    && typeof response.sessionId === "string"
    && typeof response.message === "string"
  );
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Record<string, unknown>;
  return typeof response.error === "object" && response.error !== null
    && typeof (response.error as Record<string, unknown>).code === "string"
    && typeof (response.error as Record<string, unknown>).message === "string";
}

export default function ChatClient() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const nextMessageId = useRef(1);

  const addMessage = (message: NewChatMessage) => {
    const nextMessage: ChatMessage = { id: nextMessageId.current++, ...message };
    setMessages((current) => [...current, nextMessage]);
  };

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (status === "sending") return;
    const message = draft.trim();
    if (!message) return;

    setError(null);
    setStatus("sending");
    addMessage({ role: "user", format: "plain", text: message });
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(sessionId ? { sessionId } : {}), message }),
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error("El servidor devolvió una respuesta no válida.");
      }

      if (isApiSuccess(body) && response.ok) {
        setSessionId(body.sessionId);
        setDraft("");
        if (body.status === "completed") {
          addMessage({ role: "assistant", format: "markdown", kind: "model", text: body.message });
        } else {
          addMessage({ role: "assistant", format: "plain", kind: "control", text: body.message });
        }
        return;
      }
      if (isApiError(body)) {
        if (body.error.code === "SESSION_NOT_FOUND") setSessionId(null);
        throw new Error(body.error.message);
      }
      throw new Error("No fue posible completar la respuesta del chat.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible completar la respuesta del chat.");
    } finally {
      setStatus("idle");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>FINANCE MCP</p>
          <h1 className={styles.title}>Asistente financiero</h1>
          <p className={styles.subtitle}>Consulta información de tu negocio o haz una pregunta general. Las operaciones de escritura requieren confirmación.</p>
        </header>

        <section className={styles.conversation} aria-label="Conversación">
          {messages.length === 0 ? (
            <div className={styles.emptyState}>
              <p>Escribe una pregunta para iniciar la conversación.</p>
            </div>
          ) : (
            <ol className={styles.messages} aria-live="polite">
            {messages.map((message) => (
              <li key={message.id} className={`${styles.messageRow} ${message.role === "user" ? styles.messageRowUser : styles.messageRowAssistant}`}>
                <article className={`${styles.message} ${message.role === "user" ? styles.messageUser : message.kind === "control" ? styles.messageControl : styles.messageAssistant}`}>
                  <p className={styles.messageLabel}>{message.role === "user" ? "Tú" : message.kind === "control" ? "Confirmación" : "Asistente"}</p>
                  {message.format === "markdown" ? <AssistantMarkdown content={message.text} /> : <p className={styles.plainText}>{message.text}</p>}
                </article>
              </li>
            ))}
              {status === "sending" ? <li className={styles.thinking} aria-live="assertive">Pensando…</li> : null}
            </ol>
          )}
        </section>

        <form className={styles.composer} onSubmit={submit}>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <label className="sr-only" htmlFor="chat-message">Mensaje</label>
        <textarea
          id="chat-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={status === "sending"}
          maxLength={4000}
          rows={3}
          placeholder="Escribe tu mensaje…"
          className={styles.textarea}
        />
          <div className={styles.composerFooter}>
            <p className={styles.hint}>Enter para enviar · Shift+Enter para una nueva línea</p>
            <button type="submit" disabled={status === "sending" || !draft.trim()} className={styles.sendButton}>
            Enviar
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
