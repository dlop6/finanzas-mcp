"use client";

import { KeyboardEvent, useId, useRef, useState } from "react";
import ChatClient from "./chat-client";
import FinancialDashboard from "./financial-dashboard";
import McpLogsPanel from "./mcp-logs-panel";
import styles from "./workspace.module.css";

type Tab = "dashboard" | "chat" | "logs";

export default function Workspace() {
  const [active, setActive] = useState<Tab>("dashboard");
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [logsMounted, setLogsMounted] = useState(false);
  const dashboardId = useId();
  const chatId = useId();
  const logsId = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const definitions: Array<{ value: Tab; label: string; id: string }> = [
    { value: "dashboard", label: "Resumen financiero", id: dashboardId },
    { value: "chat", label: "Chat", id: chatId },
    { value: "logs", label: "Logs MCP", id: logsId },
  ];
  const select = (next: Tab, focus = false) => {
    if (next === "logs") setLogsMounted(true);
    setActive(next);
    if (focus) requestAnimationFrame(() => tabs.current[definitions.findIndex((tab) => tab.value === next)]?.focus());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = Number(event.currentTarget.dataset.index);
    if (event.key === "ArrowRight") { event.preventDefault(); select(definitions[(index + 1) % definitions.length].value, true); }
    if (event.key === "ArrowLeft") { event.preventDefault(); select(definitions[(index + definitions.length - 1) % definitions.length].value, true); }
    if (event.key === "Home") { event.preventDefault(); select("dashboard", true); }
    if (event.key === "End") { event.preventDefault(); select("logs", true); }
  };
  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}><p className={styles.eyebrow}>FINANCE MCP</p><h1>Asistente financiero</h1><p>Consulta el estado de tu negocio o conversa con el asistente. Las operaciones de escritura requieren confirmación.</p></header>
      <div className={styles.tabs} role="tablist" aria-label="Áreas de trabajo">
        {definitions.map((tab, index) => <button key={tab.value} ref={(element) => { tabs.current[index] = element; }} data-index={index} type="button" role="tab" id={`${tab.id}-tab`} aria-selected={active === tab.value} aria-controls={`${tab.id}-panel`} tabIndex={active === tab.value ? 0 : -1} onClick={() => select(tab.value)} onKeyDown={onKeyDown}>{tab.label}</button>)}
      </div>
      <section id={`${dashboardId}-panel`} role="tabpanel" aria-labelledby={`${dashboardId}-tab`} hidden={active !== "dashboard"}><FinancialDashboard /></section>
      <section id={`${chatId}-panel`} role="tabpanel" aria-labelledby={`${chatId}-tab`} hidden={active !== "chat"} className={styles.chatPanel}><ChatClient embedded onSessionIdChange={setChatSessionId} /></section>
      <section id={`${logsId}-panel`} role="tabpanel" aria-labelledby={`${logsId}-tab`} hidden={active !== "logs"}>{logsMounted ? <McpLogsPanel chatSessionId={chatSessionId} active={active === "logs"} /> : null}</section>
    </div>
  </main>;
}
