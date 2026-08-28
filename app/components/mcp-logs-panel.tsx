"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WebMcpLogEntry, WebMcpLogsResponse } from "@/host/web";
import styles from "./mcp-logs-panel.module.css";

type PanelState =
  | { kind: "idle"; data: null; warning: null }
  | { kind: "loading"; data: null; warning: null }
  | { kind: "ready" | "refreshing"; data: WebMcpLogsResponse; warning: null }
  | { kind: "stale"; data: WebMcpLogsResponse; warning: string }
  | { kind: "failed"; data: null; warning: string };

type ApiError = { error?: { message?: unknown } };
type ServerFilter = "ALL" | "finance-mcp" | "filesystem-mcp" | "git-mcp";
type MessageFilter = "ALL" | WebMcpLogEntry["messageType"];

function isResponse(value: unknown): value is WebMcpLogsResponse {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Record<string, unknown>;
  return response.status === "ready" && typeof response.generatedAt === "string" && Array.isArray(response.groups);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-GT", {
    timeZone: "America/Guatemala",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function serverLabel(serverId: string): string {
  return serverId === "finance-mcp" ? "Finance MCP"
    : serverId === "filesystem-mcp" ? "Filesystem MCP"
      : serverId === "git-mcp" ? "Git MCP"
        : serverId;
}

function directionLabel(direction: WebMcpLogEntry["direction"]): string {
  return direction === "HOST_TO_MCP" ? "Host → MCP" : "MCP → Host";
}

function transportLabel(transport: WebMcpLogEntry["transport"]): string {
  return transport === "STREAMABLE_HTTP" ? "Streamable HTTP" : "STDIO";
}

async function requestLogs(chatSessionId: string | null): Promise<WebMcpLogsResponse> {
  const response = await fetch("/api/mcp-logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chatSessionId ? { sessionId: chatSessionId } : {}),
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok || !isResponse(body)) {
    const errorMessage = (body as ApiError).error?.message;
    const message = typeof errorMessage === "string"
      ? errorMessage
      : "No fue posible obtener los logs MCP.";
    throw new Error(message);
  }
  return body;
}

function isError(entry: WebMcpLogEntry): boolean {
  return entry.messageType === "error"
    || entry.status === "REMOTE_ERROR"
    || entry.status === "TRANSPORT_ERROR"
    || entry.status === "PROTOCOL_ERROR";
}

function LogEntry({ entry }: { entry: WebMcpLogEntry }) {
  const open = isError(entry);
  return <li className={`${styles.entry} ${open ? styles.entryError : ""}`}>
    <div className={styles.entryTop}>
      <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
      <span className={styles.status}>{entry.status}</span>
    </div>
    <dl className={styles.metadata}>
      <div><dt>Servidor</dt><dd>{serverLabel(entry.serverId)}</dd></div>
      <div><dt>Transporte</dt><dd>{transportLabel(entry.transport)}</dd></div>
      <div><dt>Dirección</dt><dd>{directionLabel(entry.direction)}</dd></div>
      <div><dt>Tipo</dt><dd>{entry.messageType}</dd></div>
      {entry.method !== undefined ? <div><dt>Método</dt><dd className={styles.mono}>{entry.method}</dd></div> : null}
      {entry.requestId !== undefined ? <div><dt>Request ID</dt><dd className={styles.mono}>Request ID: {String(entry.requestId)}</dd></div> : null}
      {entry.durationMs !== undefined ? <div><dt>Duración</dt><dd>{entry.durationMs} ms</dd></div> : null}
    </dl>
    <details className={styles.payload} open={open}>
      <summary>Ver payload JSON-RPC</summary>
      <pre><code>{entry.payload}</code></pre>
    </details>
  </li>;
}

export default function McpLogsPanel({ chatSessionId, active }: { chatSessionId: string | null; active: boolean }) {
  const [state, setState] = useState<PanelState>({ kind: "idle", data: null, warning: null });
  const [server, setServer] = useState<ServerFilter>("ALL");
  const [messageType, setMessageType] = useState<MessageFilter>("ALL");
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((current) => current.data
      ? { kind: "refreshing", data: current.data, warning: null }
      : { kind: "loading", data: null, warning: null });
    try {
      const data = await requestLogs(chatSessionId);
      setState({ kind: "ready", data, warning: null });
    } catch (error) {
      const warning = error instanceof Error ? error.message : "No fue posible obtener los logs MCP.";
      setState((current) => current.data
        ? { kind: "stale", data: current.data, warning }
        : { kind: "failed", data: null, warning });
    } finally {
      inFlight.current = false;
    }
  }, [chatSessionId]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [active, load]);

  const groups = useMemo(() => state.data?.groups.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => (server === "ALL" || entry.serverId === server)
      && (messageType === "ALL" || entry.messageType === messageType)),
  })) ?? [], [messageType, server, state.data]);
  const count = groups.reduce((total, group) => total + group.entries.length, 0);

  if (state.kind === "idle" || state.kind === "loading") {
    return <section className={styles.loading} aria-busy="true" aria-live="polite"><p className="sr-only">Cargando logs MCP</p><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></section>;
  }
  if (state.kind === "failed") {
    return <section className={styles.failure} role="alert"><h2>Logs no disponibles</h2><p>{state.warning}</p><button type="button" className={styles.refreshButton} onClick={() => void load()}>Intentar de nuevo</button></section>;
  }
  return <section className={styles.panel} aria-labelledby="mcp-logs-title" aria-busy={state.kind === "refreshing"}>
    <div className={styles.toolbar}>
      <div><p className={styles.eyebrow}>OBSERVABILIDAD LOCAL</p><h2 id="mcp-logs-title">Logs MCP</h2><p>Interacciones sanitizadas conservadas mientras este proceso está activo.</p></div>
      <div className={styles.refreshArea}><time dateTime={state.data.generatedAt}>Actualizado: {formatTimestamp(state.data.generatedAt)}</time><button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={state.kind === "refreshing"}>{state.kind === "refreshing" ? "Actualizando…" : "Actualizar"}</button></div>
    </div>
    {state.kind === "stale" ? <p className={styles.warning} role="alert">{state.warning}</p> : null}
    <div className={styles.filters} aria-label="Filtros de logs MCP">
      <label>Servidor<select value={server} onChange={(event) => setServer(event.target.value as ServerFilter)}><option value="ALL">Todos los servidores</option><option value="finance-mcp">Finance MCP</option><option value="filesystem-mcp">Filesystem MCP</option><option value="git-mcp">Git MCP</option></select></label>
      <label>Tipo de mensaje<select value={messageType} onChange={(event) => setMessageType(event.target.value as MessageFilter)}><option value="ALL">Todos los tipos</option><option value="request">request</option><option value="response">response</option><option value="notification">notification</option><option value="error">error</option></select></label>
      <p>{count} {count === 1 ? "evento visible" : "eventos visibles"}</p>
    </div>
    {groups.map((group) => <section key={group.context} className={styles.group} aria-labelledby={`mcp-logs-${group.context}`}>
      <div className={styles.groupHeading}><div><p className={styles.context}>{group.context}</p><h3 id={`mcp-logs-${group.context}`}>{group.label}</h3></div><p>{group.entries.length}</p></div>
      {group.entries.length > 0 ? <ol className={styles.entries}>{group.entries.map((entry, index) => <LogEntry key={`${entry.timestamp}-${entry.requestId ?? "notification"}-${index}`} entry={entry} />)}</ol> : <p className={styles.empty}>{group.context === "CHAT" && !chatSessionId ? "Inicia una conversación para ver sus interacciones MCP." : "Aún no hay interacciones para mostrar."}</p>}
    </section>)}
  </section>;
}
