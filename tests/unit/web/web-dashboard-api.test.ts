import { describe, expect, it } from "vitest";
import { createWebDashboardHandler, WebFinancialDashboardError } from "@/host/web";

describe("Web dashboard API", () => {
  it("returns no-store dashboard data without starting the chat runtime", async () => {
    const handler = createWebDashboardHandler(async () => ({ dashboard: { getDashboard: async () => ({ status: "ready", generatedAt: "2026-08-01T00:00:00.000Z", timezone: "America/Guatemala", period: { startDate: "2026-08-01", endDate: "2026-08-01", debtDueThrough: "2026-08-31" }, balance: { status: "error", error: { code: "TOOL_FAILED", message: "safe" } }, monthlyCashFlow: { status: "error", error: { code: "TOOL_FAILED", message: "safe" } }, receivables: { status: "error", error: { code: "TOOL_FAILED", message: "safe" } }, debts: { status: "error", error: { code: "TOOL_FAILED", message: "safe" } }, projections: { sevenDays: { status: "error", error: { code: "TOOL_FAILED", message: "safe" } }, thirtyDays: { status: "error", error: { code: "TOOL_FAILED", message: "safe" } } }, lowStock: { status: "error", error: { code: "TOOL_FAILED", message: "safe" } } }) } }));
    const response = await handler(new Request("http://localhost/api/dashboard"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects query strings and maps unavailable runtimes to safe errors", async () => {
    const unavailable = createWebDashboardHandler(async () => { throw new Error("secret endpoint"); });
    const query = await unavailable(new Request("http://localhost/api/dashboard?bad=1"));
    const failure = await unavailable(new Request("http://localhost/api/dashboard"));
    expect(query.status).toBe(400);
    expect(failure.status).toBe(503);
    expect(JSON.stringify(await failure.json())).not.toContain("secret endpoint");
  });

  it("maps a total dashboard failure to a safe 502", async () => {
    const handler = createWebDashboardHandler(async () => ({ dashboard: { getDashboard: async () => { throw new WebFinancialDashboardError("DASHBOARD_FAILED"); } } }));
    const response = await handler(new Request("http://localhost/api/dashboard"));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "DASHBOARD_FAILED" } });
  });
});
