import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "@/app/error";

afterEach(() => { cleanup(); });

describe("workspace error boundary", () => {
  it("shows a safe recovery view without rendering internal error details", () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={Object.assign(new Error("secret internal detail"), { digest: "digest-1" })} reset={reset} />);

    expect(screen.getByRole("alert").textContent).toContain("La interfaz no pudo cargarse.");
    expect(document.body.textContent).not.toContain("secret internal detail");
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
