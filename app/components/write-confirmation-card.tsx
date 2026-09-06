"use client";

import { useEffect, useRef } from "react";
import styles from "./chat-client.module.css";

export type PendingOperationView = {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  description: string;
  preview?: TransactionPreview;
};

export type TransactionBatchPreview = {
  kind: "transaction_batch";
  transactionType: "INCOME" | "EXPENSE";
  currency: "GTQ";
  items: Array<{ accountName: string; categoryName: string; amount: string; date: string; description?: string }>;
};

export type MixedTransactionBatchPreview = {
  kind: "mixed_transaction_batch";
  currency: "GTQ";
  items: Array<{ type: "INCOME" | "EXPENSE"; accountName: string; categoryName: string; amount: string; date: string; description?: string }>;
};

export type TransactionPreview = TransactionBatchPreview | MixedTransactionBatchPreview;

export type ConfirmationState = "pending" | "confirming" | "cancelling" | "confirmed" | "rejected" | "unknown" | "cancelled" | "error";

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
  if (state === "confirming") return "CONFIRMANDO OPERACIÓN";
  if (state === "cancelling") return "CANCELANDO OPERACIÓN";
  if (state === "confirmed") return "EJECUTADA";
  if (state === "rejected") return "RECHAZADA";
  if (state === "unknown") return "RESULTADO INCIERTO";
  if (state === "cancelled") return "CANCELADA";
  if (state === "error") return "ESTADO NO DISPONIBLE";
  return "CONFIRMACIÓN REQUERIDA";
}

function transactionTypeLabel(item: TransactionPreview["items"][number]): string {
  return "type" in item && item.type === "INCOME" ? "Ingreso" : "Gasto";
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
      {state === "pending" ? <p className={styles.confirmationWarning}>La operación no se ejecutará hasta que la confirmes.</p> : null}
      {state === "cancelled" ? <p className={styles.confirmationResult}>Operación cancelada.</p> : null}
      {state === "confirmed" ? <p className={styles.confirmationResult}>Operación ejecutada.</p> : null}
      {stateMessage ? <p className={styles.confirmationError} role="alert">{stateMessage}</p> : null}
      {operation.preview ? (
        <div className={styles.confirmationTableWrap} tabIndex={0} aria-label="Vista previa completa del lote">
          <table className={styles.confirmationTable}>
            <caption>{operation.preview.kind === "transaction_batch" ? `${operation.preview.transactionType === "INCOME" ? "Ingresos" : "Gastos"} que se registrarán en una sola operación` : "Ingresos y gastos que se registrarán en una sola operación"}</caption>
            <thead><tr><th scope="col">N.º</th>{operation.preview.kind === "mixed_transaction_batch" ? <th scope="col">Tipo</th> : null}<th scope="col">Monto</th><th scope="col">Fecha</th><th scope="col">Cuenta</th><th scope="col">Categoría</th><th scope="col">Descripción</th></tr></thead>
            <tbody>{operation.preview.items.map((item, index) => <tr key={`${item.date}-${item.amount}-${index}`}><td>{index + 1}</td>{operation.preview!.kind === "mixed_transaction_batch" ? <td>{transactionTypeLabel(item)}</td> : null}<td>{operation.preview!.currency} {item.amount}</td><td><time dateTime={item.date}>{item.date}</time></td><td>{item.accountName}</td><td>{item.categoryName}</td><td>{item.description ?? "Sin descripción"}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
      <details className={styles.confirmationDetails}>
        <summary>Ver argumentos exactos</summary>
        <pre><code>{JSON.stringify(operation.arguments, null, 2)}</code></pre>
      </details>
      {actionable ? (
        <div className={styles.confirmationActions}>
          <button type="button" className={styles.confirmButton} onClick={() => onDecision("confirm")}>Confirmar operación</button>
          <button type="button" className={styles.cancelButton} onClick={() => onDecision("cancel")}>Cancelar</button>
        </div>
      ) : processing ? <div className={styles.confirmationProcessing} role="status" aria-live="polite" aria-atomic="true">
        <p>{state === "confirming"
          ? "Se está enviando una única operación al sistema financiero. Mantén esta pantalla abierta mientras se confirma el resultado."
          : "Se está descartando la operación pendiente. No se ejecutará ninguna escritura."}</p>
        <div className={styles.confirmationProcessingSkeleton} aria-hidden="true"><span /><span /><span /></div>
      </div> : null}
    </section>
  );
}
