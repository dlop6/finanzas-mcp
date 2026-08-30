import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FinancialDashboard, { formatDateOnly, formatExactMoney } from "@/app/components/financial-dashboard";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const dashboard = {
  status: "ready",
  generatedAt: "2026-08-30T18:00:00.000Z",
  timezone: "America/Guatemala",
  period: { startDate: "2026-08-01", endDate: "2026-08-30", debtDueThrough: "2026-09-29" },
  balance: { status: "ready", data: { currency: "GTQ", currentBalance: "19475.00", accounts: [{ id: 1, name: "Caja", type: "CASH", initialBalance: "0.00", income: "0.00", expenses: "0.00", balance: "19475.00" }] } },
  monthlyCashFlow: { status: "ready", data: { currency: "GTQ", startDate: "2026-08-01", endDate: "2026-08-30", income: "100.00", expenses: "50.00" } },
  receivables: { status: "ready", data: { currency: "GTQ", items: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, description: `Cobro ${index + 1}`, amount: "1.00", expectedDate: "2026-09-01", confidence: "CONFIRMED" })) } },
  debts: { status: "ready", data: { currency: "GTQ", items: [] } },
  projections: { sevenDays: { status: "ready", data: { currency: "GTQ", asOfDate: "2026-08-30", throughDate: "2026-09-06", horizonDays: 7, currentBalance: "19475.00", confirmedReceivables: "0.00", unconfirmedReceivables: "0.00", fixedExpenses: "0.00", pendingDebts: "0.00", safeProjectedBalance: "19475.00", potentialProjectedBalance: "19475.00" } }, thirtyDays: { status: "ready", data: { currency: "GTQ", asOfDate: "2026-08-30", throughDate: "2026-09-29", horizonDays: 30, currentBalance: "19475.00", confirmedReceivables: "0.00", unconfirmedReceivables: "0.00", fixedExpenses: "0.00", pendingDebts: "0.00", safeProjectedBalance: "19475.00", potentialProjectedBalance: "19475.00" } } },
  lowStock: { status: "ready", data: { currency: "GTQ", items: [] } },
} as const;

describe("FinancialDashboard", () => {
  it("renders exact money, preserves five-item disclosure, and refreshes manually", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(dashboard), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FinancialDashboard />);
    await screen.findAllByText("GTQ 19,475.00");
    expect(screen.getByText("Cobro 5")).toBeTruthy();
    expect(screen.queryByText("Cobro 6")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver todos (6)" }));
    expect(screen.getByText("Cobro 6")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard", { cache: "no-store" });
  });

  it("keeps stale content visible when a refresh fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(dashboard), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "safe failure" } }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FinancialDashboard />);
    await screen.findAllByText("GTQ 19,475.00");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    await screen.findByText("safe failure");
    expect(screen.getAllByText("GTQ 19,475.00").length).toBeGreaterThan(0);
  });

  it("announces a refresh without replacing the visible dashboard", async () => {
    let resolveRefresh: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(dashboard), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveRefresh = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FinancialDashboard />);
    await screen.findAllByText("GTQ 19,475.00");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    expect(screen.getByRole("status").textContent).toContain("Actualizando resumen financiero");
    expect(screen.getAllByText("GTQ 19,475.00").length).toBeGreaterThan(0);
    resolveRefresh?.(new Response(JSON.stringify(dashboard), { status: 200 }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Resumen financiero actualizado"));
  });

  it("formats money and date-only values without numeric coercion or date shifts", () => {
    expect(formatExactMoney("GTQ", "-1234567.89")).toBe("-GTQ 1,234,567.89");
    expect(formatDateOnly("2026-08-30")).toContain("2026");
  });
});
