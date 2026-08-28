import { describe, expect, it, vi } from "vitest";
import {
  createWebFinancialDashboardService,
  getDashboardPeriod,
  WEB_DASHBOARD_LOG_SESSION_ID,
  type DashboardClock,
} from "@/host/web";
import type { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";

const clock: DashboardClock = { now: () => new Date("2026-08-31T05:30:00.000Z") };

function result(structuredContent: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: "ok" }], structuredContent };
}

function dashboardRegistry() {
  const toolsCall = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "get_current_balance") return result({ currency: "GTQ", currentBalance: "19475.00", accounts: [{ id: 1, name: "Caja", type: "CASH", initialBalance: "5000.00", income: "100.00", expenses: "50.00", balance: "5050.00" }] });
    if (name === "get_cash_flow_summary") return result({ currency: "GTQ", startDate: args.startDate, endDate: args.endDate, income: "100.00", expenses: "50.00" });
    if (name === "list_receivables") return result({ currency: "GTQ", receivables: [] });
    if (name === "list_debts") return result({ currency: "GTQ", debts: [] });
    if (name === "list_low_stock_products") return result({ currency: "GTQ", products: [] });
    return result({ currency: "GTQ", asOfDate: "2026-08-31", throughDate: name === "project_cash_flow" && args.horizonDays === 7 ? "2026-09-07" : "2026-09-30", horizonDays: args.horizonDays, currentBalance: "19475.00", confirmedReceivables: "0.00", unconfirmedReceivables: "0.00", fixedExpenses: "0.00", pendingDebts: "0.00", safeProjectedBalance: "19475.00", potentialProjectedBalance: "19475.00" });
  });
  const resolve = vi.fn((name: string) => ({ serverId: "finance-mcp", isWriteOperation: false, client: { toolsCall }, definition: { name } }));
  return { registry: { resolve } as unknown as HostMcpToolRegistry, resolve, toolsCall };
}

describe("WebFinancialDashboardService", () => {
  it("uses Guatemala month-to-date dates and only the seven expected read calls", async () => {
    const { registry, toolsCall } = dashboardRegistry();
    const dashboard = await createWebFinancialDashboardService({ registry, clock }).getDashboard();

    expect(dashboard).toMatchObject({ status: "ready", period: { startDate: "2026-08-01", endDate: "2026-08-30", debtDueThrough: "2026-09-29" } });
    expect(toolsCall).toHaveBeenCalledTimes(7);
    expect(toolsCall).toHaveBeenCalledWith("get_cash_flow_summary", { startDate: "2026-08-01", endDate: "2026-08-30" }, { sessionId: WEB_DASHBOARD_LOG_SESSION_ID });
    expect(toolsCall).toHaveBeenCalledWith("list_debts", { status: "PENDING", dueBefore: "2026-09-29" }, { sessionId: WEB_DASHBOARD_LOG_SESSION_ID });
    expect(toolsCall.mock.calls.map(([name]) => name)).not.toContain("record_income");
  });

  it("isolates malformed tool data to the affected section", async () => {
    const { registry, toolsCall } = dashboardRegistry();
    toolsCall.mockImplementation(async (name: string, args: Record<string, unknown>) => name === "list_low_stock_products"
      ? result({ currency: "GTQ", products: [{ id: "bad" }] })
      : dashboardRegistry().toolsCall(name, args));

    const dashboard = await createWebFinancialDashboardService({ registry, clock }).getDashboard();

    expect(dashboard.status).toBe("partial");
    expect(dashboard.lowStock).toMatchObject({ status: "error", error: { code: "INVALID_TOOL_RESPONSE" } });
    expect(dashboard.balance.status).toBe("ready");
  });

  it("uses date-only arithmetic across a year boundary", () => {
    expect(getDashboardPeriod({ now: () => new Date("2027-01-01T06:00:00.000Z") })).toEqual({
      startDate: "2027-01-01", endDate: "2027-01-01", debtDueThrough: "2027-01-31",
    });
  });
});
