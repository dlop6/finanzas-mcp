"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WebMcpLogEntry, WebMcpLogsResponse } from "@/host/web";
import StateNotice from "./state-notice";
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
type VisibleEntry = { entry: WebMcpLogEntry; sourceIndex: number; key: string };

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

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-GT", {
    timeZone: "America/Guatemala",
    timeStyle: "medium",
  }).format(date);
}

function formatDuration(value: number): string {
  return `${new Intl.NumberFormat("es-GT", { maximumFractionDigits: 1 }).format(value)} ms`;
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

function messageTypeLabel(messageType: WebMcpLogEntry["messageType"]): string {
  if (messageType === "request") return "Solicitud";
  if (messageType === "response") return "Respuesta";
  if (messageType === "notification") return "Notificación";
  return "Error";
}

function statusLabel(status: WebMcpLogEntry["status"]): string {
  if (status === "SENT") return "Enviado";
  if (status === "SUCCEEDED") return "Completado";
  if (status === "REMOTE_ERROR") return "Error remoto";
  if (status === "TRANSPORT_ERROR") return "Error de transporte";
  return "Error de protocolo";
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

function entryKey(context: string, entry: WebMcpLogEntry, sourceIndex: number): string {
  return `${context}:${entry.timestamp}:${String(entry.requestId ?? entry.messageType)}:${sourceIndex}`;
}

function reconcileExpandedPayloads(current: ReadonlySet<string>, knownEntries: ReadonlySet<string>, data: WebMcpLogsResponse): Set<string> {
  const valid = new Set<string>();
  const errors = new Set<string>();
  for (const group of data.groups) {
    group.entries.forEach((entry, index) => {
      const key = entryKey(group.context, entry, index);
      valid.add(key);
      if (isError(entry) && !knownEntries.has(key)) errors.add(key);
    });
  }
  return new Set([...current].filter((key) => valid.has(key)).concat([...errors]));
}

function LogTable({ label, context, entries, expandedPayloads, onToggle }: { label: string; context: string; entries: VisibleEntry[]; expandedPayloads: ReadonlySet<string>; onToggle: (key: string) => void }) {
  return <div className={styles.tableRegion} role="region" aria-label={`Tabla de ${label}`} tabIndex={0}>
    <table className={styles.table}>
      <caption className="sr-only">Eventos de {label}</caption>
      <thead><tr><th scope="col">Hora</th><th scope="col">Evento</th><th scope="col">Resultado</th></tr></thead>
      {entries.map(({ entry, sourceIndex, key }) => {
        const expanded = expandedPayloads.has(key);
        const payloadId = `mcp-log-payload-${context}-${sourceIndex}`;
        const method = entry.method ?? messageTypeLabel(entry.messageType);
        const action = expanded ? "Ocultar" : "Ver";
        return <tbody key={key} className={isError(entry) ? styles.errorRows : undefined}>
          <tr className={styles.eventRow}>
            <td className={styles.timeCell}><time dateTime={entry.timestamp} title={formatTimestamp(entry.timestamp)}><span aria-hidden="true">{formatTime(entry.timestamp)}</span><span className="sr-only">{formatTimestamp(entry.timestamp)}</span></time></td>
            <td className={styles.eventCell}>
              <strong>{serverLabel(entry.serverId)}</strong>
              <span>{messageTypeLabel(entry.messageType)}{entry.method !== undefined ? <> · <code>{entry.method}</code></> : null}</span>
              <span><span>{directionLabel(entry.direction)}</span><span aria-hidden="true"> · </span><span>{transportLabel(entry.transport)}</span></span>
              {entry.requestId !== undefined ? <code>Request ID: {String(entry.requestId)}</code> : null}
            </td>
            <td className={styles.resultCell}>
              <span className={styles.statusLabel}>{statusLabel(entry.status)}</span>
              <code className={styles.statusCode}>{entry.status}</code>
              {entry.durationMs !== undefined ? <span>{formatDuration(entry.durationMs)}</span> : null}
              <button type="button" className={styles.payloadButton} aria-expanded={expanded} aria-controls={payloadId} onClick={() => onToggle(key)} aria-label={`${action} payload de ${method}, ${messageTypeLabel(entry.messageType)}${entry.requestId !== undefined ? `, Request ID ${String(entry.requestId)}` : ""}`}>{action} payload</button>
            </td>
          </tr>
          {expanded ? <tr className={styles.payloadRow}><td colSpan={3}><div id={payloadId} className={styles.payload}><pre><code>{entry.payload}</code></pre></div></td></tr> : null}
        </tbody>;
      })}
    </table>
  </div>;
}

export default function McpLogsPanel({ chatSessionId, active }: { chatSessionId: string | null; active: boolean }) {
  const [state, setState] = useState<PanelState>({ kind: "idle", data: null, warning: null });
  const [server, setServer] = useState<ServerFilter>("ALL");
  const [messageType, setMessageType] = useState<MessageFilter>("ALL");
  const [expandedPayloads, setExpandedPayloads] = useState<Set<string>>(() => new Set());
  const inFlight = useRef(false);
  const knownEntries = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((current) => current.data
      ? { kind: "refreshing", data: current.data, warning: null }
      : { kind: "loading", data: null, warning: null });
    try {
      const data = await requestLogs(chatSessionId);
      const previouslyKnownEntries = knownEntries.current;
      setExpandedPayloads((current) => reconcileExpandedPayloads(current, previouslyKnownEntries, data));
      knownEntries.current = new Set(data.groups.flatMap((group) => group.entries.map((entry, index) => entryKey(group.context, entry, index))));
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
    entries: group.entries.map((entry, sourceIndex) => ({ entry, sourceIndex, key: entryKey(group.context, entry, sourceIndex) }))
      .filter(({ entry }) => (server === "ALL" || entry.serverId === server)
        && (messageType === "ALL" || entry.messageType === messageType)),
  })) ?? [], [messageType, server, state.data]);
  const count = groups.reduce((total, group) => total + group.entries.length, 0);
  const filtersActive = server !== "ALL" || messageType !== "ALL";

  if (state.kind === "idle" || state.kind === "loading") {
    return <section className={styles.loading} aria-busy="true" aria-live="polite"><p className="sr-only">Cargando logs MCP</p><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></section>;
  }
  if (state.kind === "failed") return <StateNotice className={styles.failure} tone="error" role="alert" title="Logs no disponibles" message={state.warning} action={{ label: "Intentar de nuevo", onClick: () => void load() }} />;
  return <section className={styles.panel} aria-labelledby="mcp-logs-title" aria-busy={state.kind === "refreshing"}>
    <p className="sr-only" role="status">{state.kind === "refreshing" ? "Actualizando logs MCP" : "Logs MCP actualizados"}</p>
    <div className={styles.toolbar}>
      <div><p className={styles.eyebrow}>OBSERVABILIDAD LOCAL</p><h2 id="mcp-logs-title">Logs MCP</h2><p>Interacciones sanitizadas conservadas mientras este proceso está activo.</p></div>
      <div className={styles.refreshArea}><time dateTime={state.data.generatedAt}>Actualizado: {formatTimestamp(state.data.generatedAt)}</time><button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={state.kind === "refreshing"}>{state.kind === "refreshing" ? "Actualizando…" : "Actualizar"}</button></div>
    </div>
    {state.kind === "stale" ? <p className={styles.warning} role="alert">{state.warning}</p> : null}
    <div className={styles.filters} aria-label="Filtros de logs MCP">
      <label>Servidor<select value={server} onChange={(event) => setServer(event.target.value as ServerFilter)}><option value="ALL">Todos los servidores</option><option value="finance-mcp">Finance MCP</option><option value="filesystem-mcp">Filesystem MCP</option><option value="git-mcp">Git MCP</option></select></label>
      <label>Tipo de mensaje<select value={messageType} onChange={(event) => setMessageType(event.target.value as MessageFilter)}><option value="ALL">Todos los tipos</option><option value="request">Solicitudes</option><option value="response">Respuestas</option><option value="notification">Notificaciones</option><option value="error">Errores</option></select></label>
      <p>{count} {count === 1 ? "evento visible" : "eventos visibles"}</p>
    </div>
    {groups.map((group) => <section key={group.context} className={styles.group} aria-labelledby={`mcp-logs-${group.context}`}>
      <div className={styles.groupHeading}><div><p className={styles.context}>{group.context}</p><h3 id={`mcp-logs-${group.context}`}>{group.label}</h3></div><p>{group.entries.length}</p></div>
      {group.entries.length > 0 ? <LogTable label={group.label} context={group.context} entries={group.entries} expandedPayloads={expandedPayloads} onToggle={(key) => setExpandedPayloads((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })} /> : <p className={styles.empty}>{filtersActive ? "No hay eventos que coincidan con los filtros seleccionados." : group.context === "CHAT" && !chatSessionId ? "Inicia una conversación para ver sus interacciones MCP." : "Aún no hay interacciones para mostrar."}</p>}
    </section>)}
  </section>;
}
