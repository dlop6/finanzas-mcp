"use client";

import { FormEvent, KeyboardEvent, useRef, useState } from "react";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
};

type ApiSuccess = {
  status: "completed" | "confirmation_required" | "cancelled";
  sessionId: string;
  message: string;
};

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

  const addMessage = (role: ChatMessage["role"], text: string) => {
    setMessages((current) => [...current, { id: nextMessageId.current++, role, text }]);
  };

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (status === "sending") return;
    const message = draft.trim();
    if (!message) return;

    setError(null);
    setStatus("sending");
    addMessage("user", message);
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
        addMessage("assistant", body.message);
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
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8 sm:px-8">
      <header className="mb-8 border-b border-slate-200 pb-6">
        <p className="text-sm font-semibold tracking-wide text-emerald-700">FINANCE MCP</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Asistente financiero</h1>
        <p className="mt-2 max-w-2xl text-slate-600">Consulta información de tu negocio o haz una pregunta general. Las operaciones de escritura requieren confirmación.</p>
      </header>

      <section className="flex flex-1 flex-col" aria-label="Conversación">
        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
            <p>Escribe una pregunta para iniciar la conversación.</p>
          </div>
        ) : (
          <ol className="flex flex-1 flex-col gap-4" aria-live="polite">
            {messages.map((message) => (
              <li key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <article className={message.role === "user" ? "max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-700 px-4 py-3 text-white" : "max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-slate-900 shadow-sm ring-1 ring-slate-200"}>
                  <p className="mb-1 text-xs font-semibold opacity-75">{message.role === "user" ? "Tú" : "Asistente"}</p>
                  <p className="whitespace-pre-wrap break-words">{message.text}</p>
                </article>
              </li>
            ))}
            {status === "sending" ? <li className="text-sm text-slate-500" aria-live="assertive">Pensando…</li> : null}
          </ol>
        )}
      </section>

      <form className="mt-6 rounded-xl border border-slate-200 bg-white p-3 shadow-sm" onSubmit={submit}>
        {error ? <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
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
          className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-slate-950 outline-none placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100"
        />
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-xs text-slate-500">Enter para enviar · Shift+Enter para una nueva línea</p>
          <button type="submit" disabled={status === "sending" || !draft.trim()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400">
            Enviar
          </button>
        </div>
      </form>
    </main>
  );
}
