"use client";

import { useEffect, useRef } from "react";
import styles from "./chat-client.module.css";

export type PendingOperationView = {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  description: string;
};

export type ConfirmationState = "pending" | "confirming" | "cancelling" | "confirmed" | "cancelled" | "error";

type WriteConfirmationCardProps = {
  messageId: number;
  operation: PendingOperationView;
  state: ConfirmationState;
  stateMessage?: string;
  onDecision: (decision: "confirm" | "cancel") => void;
};

const serverLabels: Record<string, string> = {
  "finance-mcp": "Finance MCP",
  "filesystem-mcp": "Filesystem MCP",
  "git-mcp": "Git MCP",
};

function stateLabel(state: ConfirmationState): string {
  if (state === "confirmed") return "CONFIRMADA";
  if (state === "cancelled") return "CANCELADA";
  if (state === "error") return "ESTADO NO DISPONIBLE";
  return "CONFIRMACIÓN REQUERIDA";
}

export default function WriteConfirmationCard({ messageId, operation, state, stateMessage, onDecision }: WriteConfirmationCardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const actionable = state === "pending";
  const processing = state === "confirming" || state === "cancelling";
  const titleId = `confirmation-title-${messageId}`;
  const descriptionId = `confirmation-description-${messageId}`;

  useEffect(() => {
    if (state === "pending") headingRef.current?.focus();
  }, [state]);

  return (
    <section
      className={`${styles.confirmationCard} ${styles[`confirmation${state[0].toUpperCase()}${state.slice(1)}`]}`}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={processing}
    >
      <h2 ref={headingRef} id={titleId} tabIndex={-1} className={styles.confirmationTitle}>{stateLabel(state)}</h2>
      <p id={descriptionId} className={styles.confirmationDescription}>{operation.description}</p>
      <dl className={styles.confirmationMetadata}>
        <div><dt>Servidor</dt><dd>{serverLabels[operation.serverId] ?? operation.serverId}</dd></div>
        <div><dt>Herramienta</dt><dd><code>{operation.toolName}</code></dd></div>
      </dl>
      {state === "pending" || processing ? <p className={styles.confirmationWarning}>La operación no se ejecutará hasta que la confirmes.</p> : null}
      {state === "cancelled" ? <p className={styles.confirmationResult}>Operación cancelada.</p> : null}
      {state === "confirmed" ? <p className={styles.confirmationResult}>Operación confirmada.</p> : null}
      {stateMessage ? <p className={styles.confirmationError} role="alert">{stateMessage}</p> : null}
      <details className={styles.confirmationDetails}>
        <summary>Ver argumentos exactos</summary>
        <pre><code>{JSON.stringify(operation.arguments, null, 2)}</code></pre>
      </details>
      {actionable ? (
        <div className={styles.confirmationActions}>
          <button type="button" className={styles.confirmButton} onClick={() => onDecision("confirm")}>Confirmar operación</button>
          <button type="button" className={styles.cancelButton} onClick={() => onDecision("cancel")}>Cancelar</button>
        </div>
      ) : processing ? <p className={styles.confirmationProcessing} aria-live="polite">{state === "confirming" ? "Confirmando…" : "Cancelando…"}</p> : null}
    </section>
  );
}
