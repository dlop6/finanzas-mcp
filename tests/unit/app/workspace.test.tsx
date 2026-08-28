import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Workspace from "@/app/components/workspace";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const dashboard = {
  status: "ready",
  generatedAt: "2026-08-30T18:00:00.000Z",
  timezone: "America/Guatemala",
  period: { startDate: "2026-08-01", endDate: "2026-08-30", debtDueThrough: "2026-09-29" },
  balance: { status: "ready", data: { currency: "GTQ", currentBalance: "1.00", accounts: [] } },
  monthlyCashFlow: { status: "ready", data: { currency: "GTQ", startDate: "2026-08-01", endDate: "2026-08-30", income: "1.00", expenses: "1.00" } },
  receivables: { status: "ready", data: { currency: "GTQ", items: [] } },
  debts: { status: "ready", data: { currency: "GTQ", items: [] } },
  projections: {
    sevenDays: { status: "ready", data: { currency: "GTQ", asOfDate: "2026-08-30", throughDate: "2026-09-06", horizonDays: 7, currentBalance: "1.00", confirmedReceivables: "0.00", unconfirmedReceivables: "0.00", fixedExpenses: "0.00", pendingDebts: "0.00", safeProjectedBalance: "1.00", potentialProjectedBalance: "1.00" } },
    thirtyDays: { status: "ready", data: { currency: "GTQ", asOfDate: "2026-08-30", throughDate: "2026-09-29", horizonDays: 30, currentBalance: "1.00", confirmedReceivables: "0.00", unconfirmedReceivables: "0.00", fixedExpenses: "0.00", pendingDebts: "0.00", safeProjectedBalance: "1.00", potentialProjectedBalance: "1.00" } },
  },
  lowStock: { status: "ready", data: { currency: "GTQ", items: [] } },
} as const;

describe("Workspace", () => {
  it("opens on the dashboard and preserves a chat draft across accessible tab changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(dashboard), { status: 200 })));
    render(<Workspace />);

    await screen.findByText("Resumen financiero");
    const dashboardTab = screen.getByRole("tab", { name: "Resumen financiero" });
    const chatTab = screen.getByRole("tab", { name: "Chat" });
    expect(dashboardTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(dashboardTab, { key: "ArrowRight" });
    expect(chatTab.getAttribute("aria-selected")).toBe("true");
    const message = screen.getByRole("textbox", { name: "Mensaje" });
    fireEvent.change(message, { target: { value: "No perder este borrador" } });

    fireEvent.keyDown(chatTab, { key: "Home" });
    expect(dashboardTab.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(chatTab);
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Mensaje" }) as HTMLTextAreaElement).value).toBe("No perder este borrador"));
  });
});
