"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./state-notice.module.css";

export type StateNoticeTone = "empty" | "warning" | "error";

export type StateNoticeProps = {
  title: string;
  message: ReactNode;
  tone: StateNoticeTone;
  action?: { label: string; onClick: () => void };
  role?: "alert" | "status";
  focusTitle?: boolean;
  className?: string;
};

export default function StateNotice({
  title,
  message,
  tone,
  action,
  role,
  focusTitle = false,
  className,
}: StateNoticeProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusTitle) headingRef.current?.focus();
  }, [focusTitle]);

  return <section className={[styles.notice, styles[tone], className].filter(Boolean).join(" ")} role={role}>
    <h2 ref={headingRef} tabIndex={focusTitle ? -1 : undefined}>{title}</h2>
    <p>{message}</p>
    {action ? <button type="button" className={styles.action} onClick={action.onClick}>{action.label}</button> : null}
  </section>;
}
