"use client";

import { KeyboardEvent, useId, useRef, useState } from "react";
import ChatClient from "./chat-client";
import FinancialDashboard from "./financial-dashboard";
import styles from "./workspace.module.css";

type Tab = "dashboard" | "chat";

export default function Workspace() {
  const [active, setActive] = useState<Tab>("dashboard");
  const dashboardId = useId();
  const chatId = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (next: Tab, focus = false) => {
    setActive(next);
    if (focus) requestAnimationFrame(() => tabs.current[next === "dashboard" ? 0 : 1]?.focus());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = event.currentTarget.dataset.index === "0" ? 0 : 1;
    if (event.key === "ArrowRight") { event.preventDefault(); select(index === 0 ? "chat" : "dashboard", true); }
    if (event.key === "ArrowLeft") { event.preventDefault(); select(index === 0 ? "chat" : "dashboard", true); }
    if (event.key === "Home") { event.preventDefault(); select("dashboard", true); }
    if (event.key === "End") { event.preventDefault(); select("chat", true); }
  };
  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.header}><p className={styles.eyebrow}>FINANCE MCP</p><h1>Asistente financiero</h1><p>Consulta el estado de tu negocio o conversa con el asistente. Las operaciones de escritura requieren confirmación.</p></header>
      <div className={styles.tabs} role="tablist" aria-label="Áreas de trabajo">
        <button ref={(element) => { tabs.current[0] = element; }} data-index="0" type="button" role="tab" id={`${dashboardId}-tab`} aria-selected={active === "dashboard"} aria-controls={`${dashboardId}-panel`} tabIndex={active === "dashboard" ? 0 : -1} onClick={() => select("dashboard")} onKeyDown={onKeyDown}>Resumen financiero</button>
        <button ref={(element) => { tabs.current[1] = element; }} data-index="1" type="button" role="tab" id={`${chatId}-tab`} aria-selected={active === "chat"} aria-controls={`${chatId}-panel`} tabIndex={active === "chat" ? 0 : -1} onClick={() => select("chat")} onKeyDown={onKeyDown}>Chat</button>
      </div>
      <section id={`${dashboardId}-panel`} role="tabpanel" aria-labelledby={`${dashboardId}-tab`} hidden={active !== "dashboard"}><FinancialDashboard /></section>
      <section id={`${chatId}-panel`} role="tabpanel" aria-labelledby={`${chatId}-tab`} hidden={active !== "chat"} className={styles.chatPanel}><ChatClient embedded /></section>
    </div>
  </main>;
}
