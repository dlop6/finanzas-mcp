"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import type {
  DashboardDebt,
  DashboardProjection,
  DashboardProduct,
  DashboardReceivable,
  DashboardSection,
  WebFinancialDashboardResponse,
} from "@/host/web";
import StateNotice from "./state-notice";
import styles from "./financial-dashboard.module.css";

type DashboardState =
  | { kind: "loading"; data: null; warning: null }
  | { kind: "ready"; data: WebFinancialDashboardResponse; warning: null }
  | { kind: "refreshing"; data: WebFinancialDashboardResponse; warning: null }
  | { kind: "stale"; data: WebFinancialDashboardResponse; warning: string }
  | { kind: "failed"; data: null; warning: string };

type DashboardApiError = { error?: { code?: unknown; message?: unknown } };

function isDashboard(value: unknown): value is WebFinancialDashboardResponse {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Record<string, unknown>;
  return (response.status === "ready" || response.status === "partial")
    && typeof response.generatedAt === "string"
    && typeof response.period === "object" && response.period !== null;
}

async function requestDashboard(): Promise<WebFinancialDashboardResponse> {
  const response = await fetch("/api/dashboard", { cache: "no-store" });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok || !isDashboard(body)) {
    const message = typeof (body as DashboardApiError).error?.message === "string"
      ? (body as DashboardApiError).error?.message as string
      : "No fue posible obtener el resumen financiero.";
    throw new Error(message);
  }
  return body;
}

export function formatExactMoney(currency: string, value: string): string {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match) return `${currency} ${value}`;
  const [, sign, whole, decimal] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign ? "-" : ""}${currency} ${grouped}.${decimal}`;
}

export function formatDateOnly(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return new Intl.DateTimeFormat("es-GT", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

function formatUpdated(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : new Intl.DateTimeFormat("es-GT", {
    timeZone: "America/Guatemala", dateStyle: "medium", timeStyle: "short",
  }).format(parsed);
}

function sectionData<T>(section: DashboardSection<T>): T | null {
  return section.status === "ready" ? section.data : null;
}

function SectionError({ title }: { title: string }) {
  return <StateNotice className={`${styles.card} ${styles.sectionError}`} tone="error" title={title} message="No se pudo obtener esta información." />;
}

function ExpandableList<T>({
  title,
  items,
  empty,
  render,
}: {
  title: string;
  items: T[];
  empty: string;
  render: (item: T) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const visible = expanded ? items : items.slice(0, 5);
  return <section className={styles.card} aria-labelledby={`${id}-title`}>
    <div className={styles.cardHeading}>
      <div>
        <h2 id={`${id}-title`}>{title}</h2>
        <p className={styles.count}>{items.length} {items.length === 1 ? "elemento" : "elementos"}</p>
      </div>
    </div>
    {items.length === 0 ? <p className={styles.emptyCopy}>{empty}</p> : <>
      <ol id={id} className={styles.detailList}>
        {visible.map(render)}
      </ol>
      {items.length > 5 ? <button className={styles.textButton} type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} aria-controls={id}>
        {expanded ? "Ver menos" : `Ver todos (${items.length})`}
      </button> : null}
    </>}
  </section>;
}

function DebtList({ section, today }: { section: DashboardSection<{ currency: string; items: DashboardDebt[] }>; today: string }) {
  const data = sectionData(section);
  if (!data) return <SectionError title="Deudas próximas" />;
  return <ExpandableList title="Deudas próximas" items={data.items} empty="No hay deudas pendientes para los próximos 30 días." render={(item) => {
    const timing = item.dueDate < today ? "Vencida" : item.dueDate === today ? "Vence hoy" : "Próxima";
    const priority = item.priority === "HIGH" ? "Alta" : item.priority === "MEDIUM" ? "Media" : "Baja";
    return <li key={item.id} className={styles.listItem}>
      <div><strong>{item.description}</strong><span>{priority} · {timing}</span></div>
      <div className={styles.itemValues}><strong>{formatExactMoney(data.currency, item.amount)}</strong><time dateTime={item.dueDate}>{formatDateOnly(item.dueDate)}</time></div>
    </li>;
  }} />;
}

function ReceivableList({ section }: { section: DashboardSection<{ currency: string; items: DashboardReceivable[] }> }) {
  const data = sectionData(section);
  if (!data) return <SectionError title="Cuentas por cobrar" />;
  return <ExpandableList title="Cuentas por cobrar" items={data.items} empty="No hay cuentas por cobrar pendientes." render={(item) => <li key={item.id} className={styles.listItem}>
    <div><strong>{item.description}</strong><span>{item.confidence === "CONFIRMED" ? "Confirmada" : "No confirmada"}</span></div>
    <div className={styles.itemValues}><strong>{formatExactMoney(data.currency, item.amount)}</strong><time dateTime={item.expectedDate}>{formatDateOnly(item.expectedDate)}</time></div>
  </li>} />;
}

function LowStockList({ section }: { section: DashboardSection<{ currency: string; items: DashboardProduct[] }> }) {
  const data = sectionData(section);
  if (!data) return <SectionError title="Stock bajo" />;
  return <ExpandableList title="Stock bajo" items={data.items} empty="No hay productos con stock bajo." render={(item) => <li key={item.id} className={styles.listItem}>
    <div><strong>{item.name}</strong><span>Stock mínimo: {item.minimumStock}</span></div>
    <div className={styles.itemValues}><strong>{item.stock}</strong><span>en existencia</span></div>
  </li>} />;
}

function ProjectionCard({ section, title }: { section: DashboardSection<DashboardProjection>; title: string }) {
  const data = sectionData(section);
  if (!data) return <SectionError title={title} />;
  const items: Array<[string, string]> = [
    ["Saldo actual", data.currentBalance], ["Cobros confirmados", data.confirmedReceivables], ["Cobros no confirmados", data.unconfirmedReceivables], ["Gastos fijos", data.fixedExpenses], ["Deudas pendientes", data.pendingDebts],
  ];
  return <section className={`${styles.card} ${styles.projectionCard}`} aria-labelledby={`${title}-title`}>
    <h2 id={`${title}-title`}>{title}</h2>
    <p className={styles.projectionDates}><time dateTime={data.asOfDate}>{formatDateOnly(data.asOfDate)}</time> → <time dateTime={data.throughDate}>{formatDateOnly(data.throughDate)}</time></p>
    <dl className={styles.metrics}>{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatExactMoney(data.currency, value)}</dd></div>)}</dl>
    <div className={styles.projectionTotals}><span>Saldo seguro</span><strong>{formatExactMoney(data.currency, data.safeProjectedBalance)}</strong><span>Saldo potencial</span><strong>{formatExactMoney(data.currency, data.potentialProjectedBalance)}</strong></div>
  </section>;
}

function DashboardContent({ data, warning, onRefresh, refreshing }: { data: WebFinancialDashboardResponse; warning: string | null; onRefresh: () => void; refreshing: boolean }) {
  const balance = sectionData(data.balance);
  const flow = sectionData(data.monthlyCashFlow);
  return <div className={styles.dashboard} aria-busy={refreshing}>
    <p className="sr-only" role="status">{refreshing ? "Actualizando resumen financiero" : "Resumen financiero actualizado"}</p>
    <div className={styles.toolbar}>
      <div><p className={styles.eyebrow}>FINANCE MCP</p><h2>Resumen financiero</h2><p>Acumulado del 1 al <time dateTime={data.period.endDate}>{formatDateOnly(data.period.endDate)}</time>.</p></div>
      <div className={styles.refreshArea}><time dateTime={data.generatedAt}>Actualizado: {formatUpdated(data.generatedAt)}</time><button type="button" className={styles.refreshButton} onClick={onRefresh} disabled={refreshing}>{refreshing ? "Actualizando…" : "Actualizar"}</button></div>
    </div>
    {data.status === "partial" || warning ? <p className={styles.warning} role="status">{warning ?? "Algunos datos no pudieron actualizarse."}</p> : null}
    <section className={styles.kpiGrid} aria-label="Indicadores principales">
      {balance ? <section className={`${styles.card} ${styles.balanceCard}`}><p className={styles.kpiLabel}>Saldo actual</p><strong className={styles.kpiValue}>{formatExactMoney(balance.currency, balance.currentBalance)}</strong><details><summary>Ver cuentas ({balance.accounts.length})</summary><ul className={styles.accountList}>{balance.accounts.map((account) => <li key={account.id}><span>{account.name}</span><strong>{formatExactMoney(balance.currency, account.balance)}</strong></li>)}</ul></details></section> : <SectionError title="Saldo actual" />}
      {flow ? <section className={styles.card}><p className={styles.kpiLabel}>Ingresos del mes</p><strong className={styles.kpiValue}>{formatExactMoney(flow.currency, flow.income)}</strong><p className={styles.kpiDescription}>Del <time dateTime={flow.startDate}>{formatDateOnly(flow.startDate)}</time> al <time dateTime={flow.endDate}>{formatDateOnly(flow.endDate)}</time>.</p></section> : <SectionError title="Ingresos del mes" />}
      {flow ? <section className={styles.card}><p className={styles.kpiLabel}>Egresos del mes</p><strong className={styles.kpiValue}>{formatExactMoney(flow.currency, flow.expenses)}</strong><p className={styles.kpiDescription}>Del <time dateTime={flow.startDate}>{formatDateOnly(flow.startDate)}</time> al <time dateTime={flow.endDate}>{formatDateOnly(flow.endDate)}</time>.</p></section> : <SectionError title="Egresos del mes" />}
    </section>
    <section className={styles.sectionGroup} aria-labelledby="projections-title"><div className={styles.sectionTitle}><p className={styles.eyebrow}>PROYECCIONES</p><h2 id="projections-title">Flujo de caja estimado</h2></div><div className={styles.projectionGrid}><ProjectionCard section={data.projections.sevenDays} title="Proyección a 7 días" /><ProjectionCard section={data.projections.thirtyDays} title="Proyección a 30 días" /></div></section>
    <section className={styles.sectionGroup} aria-labelledby="attention-title"><div className={styles.sectionTitle}><p className={styles.eyebrow}>ATENCIÓN</p><h2 id="attention-title">Pendientes importantes</h2></div><div className={styles.attentionGrid}><ReceivableList section={data.receivables} /><DebtList section={data.debts} today={data.period.endDate} /><LowStockList section={data.lowStock} /></div></section>
  </div>;
}

function DashboardSkeleton() {
  return <div className={styles.dashboard} aria-busy="true" aria-live="polite"><p className="sr-only">Cargando resumen financiero</p><div className={`${styles.skeleton} ${styles.skeletonHeader}`} /><div className={styles.kpiGrid}>{[1, 2, 3].map((item) => <div key={item} className={`${styles.skeleton} ${styles.skeletonCard}`} />)}</div><div className={styles.projectionGrid}>{[1, 2].map((item) => <div key={item} className={`${styles.skeleton} ${styles.skeletonLarge}`} />)}</div></div>;
}

export default function FinancialDashboard() {
  const [state, setState] = useState<DashboardState>({ kind: "loading", data: null, warning: null });
  const load = async () => {
    setState((current) => current.data ? { kind: "refreshing", data: current.data, warning: null } : { kind: "loading", data: null, warning: null });
    try {
      setState({ kind: "ready", data: await requestDashboard(), warning: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible obtener el resumen financiero.";
      setState((current) => current.data ? { kind: "stale", data: current.data, warning: message } : { kind: "failed", data: null, warning: message });
    }
  };
  useEffect(() => {
    let active = true;
    void requestDashboard().then(
      (data) => { if (active) setState({ kind: "ready", data, warning: null }); },
      (error: unknown) => {
        if (!active) return;
        setState({ kind: "failed", data: null, warning: error instanceof Error ? error.message : "No fue posible obtener el resumen financiero." });
      },
    );
    return () => { active = false; };
  }, []);
  if (state.kind === "loading") return <DashboardSkeleton />;
  if (state.kind === "failed") return <StateNotice className={styles.failure} tone="error" role="alert" title="Resumen no disponible" message={state.warning} action={{ label: "Intentar de nuevo", onClick: () => void load() }} />;
  return <DashboardContent data={state.data} warning={state.warning} onRefresh={() => void load()} refreshing={state.kind === "refreshing"} />;
}
