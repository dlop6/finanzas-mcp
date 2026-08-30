"use client";

import StateNotice from "./components/state-notice";
import styles from "./error.module.css";

export default function ErrorBoundary({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  void error;
  return <main className={styles.page}>
    <StateNotice
      className={styles.notice}
      tone="error"
      role="alert"
      focusTitle
      title="La interfaz no pudo cargarse."
      message="Ocurrió un problema inesperado. Intenta cargar nuevamente la interfaz."
      action={{ label: "Intentar de nuevo", onClick: reset }}
    />
  </main>;
}
