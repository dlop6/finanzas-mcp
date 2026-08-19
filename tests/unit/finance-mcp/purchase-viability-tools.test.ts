import { FinanceDomainError, type PurchaseViabilityService } from "@/servers/finance-mcp/services";
import { createPurchaseViabilityTools } from "@/servers/finance-mcp/tools/purchase-viability-tools";
import { FinanceToolRegistry } from "@/servers/finance-mcp/tools/registry";
import { describe, expect, it, vi } from "vitest";

const result = {
  currency: "GTQ" as const,
  asOfDate: "2026-08-08",
  throughDate: "2026-08-15",
  horizonDays: 7 as const,
  currentBalance: "19475.00",
  purchaseAmount: "100.00",
  confirmedReceivables: "3200.00",
  unconfirmedReceivables: "0.00",
  fixedExpenses: "650.00",
  pendingDebts: "2200.00",
  safeProjectedBalance: "19825.00",
  potentialProjectedBalance: "19825.00",
  minimumSafetyBalance: "1500.00",
  safeBalanceAfterPurchase: "19725.00",
  potentialBalanceAfterPurchase: "19725.00",
  maximumSafePurchase: "18325.00",
  status: "VIABLE" as const,
};

function createRegistry() {
  const evaluatePurchaseViability = vi.fn().mockResolvedValue(result);
  const registry = new FinanceToolRegistry(createPurchaseViabilityTools({ evaluatePurchaseViability } as unknown as PurchaseViabilityService));
  return { registry, evaluatePurchaseViability };
}

describe("purchase viability MCP tool", () => {
  it("exposes only its public read contract", () => {
    const { registry } = createRegistry();

    expect(registry.list()).toEqual([{
      name: "evaluate_purchase_viability",
      description: "Evaluate whether a purchase preserves the minimum safety balance.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["purchaseAmount", "horizonDays"],
        properties: {
          purchaseAmount: { type: "string", pattern: "^(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,2})?$" },
          horizonDays: { type: "integer", enum: [7, 30] },
        },
      },
    }]);
  });

  it("evaluates valid arguments as a read operation", async () => {
    const { registry, evaluatePurchaseViability } = createRegistry();

    await expect(registry.execute("evaluate_purchase_viability", { purchaseAmount: "100.00", horizonDays: 7 })).resolves.toEqual({
      ok: true,
      result: { content: [{ type: "text", text: "Purchase viability evaluated." }], structuredContent: result },
    });
    expect(evaluatePurchaseViability).toHaveBeenCalledWith("100.00", 7);
  });

  it.each([
    {},
    { purchaseAmount: "100.00" },
    { horizonDays: 7 },
    { purchaseAmount: "100.00", horizonDays: 14 },
    { purchaseAmount: "1.234", horizonDays: 7 },
    { purchaseAmount: "100.00", horizonDays: 7, extra: true },
  ])("rejects invalid schema arguments without executing the service", async (args) => {
    const { registry, evaluatePurchaseViability } = createRegistry();

    await expect(registry.execute("evaluate_purchase_viability", args)).resolves.toMatchObject({
      ok: false,
      reason: "INVALID_ARGUMENTS",
      result: { isError: true },
    });
    expect(evaluatePurchaseViability).not.toHaveBeenCalled();
  });

  it("returns expected domain errors as MCP tool errors", async () => {
    const evaluatePurchaseViability = vi.fn().mockRejectedValue(new FinanceDomainError("Amount must be greater than zero."));
    const registry = new FinanceToolRegistry(createPurchaseViabilityTools({ evaluatePurchaseViability } as unknown as PurchaseViabilityService));

    await expect(registry.execute("evaluate_purchase_viability", { purchaseAmount: "0", horizonDays: 7 })).resolves.toEqual({
      ok: true,
      result: { content: [{ type: "text", text: "Amount must be greater than zero." }], isError: true },
    });
  });

  it("propagates unexpected errors to the lifecycle", async () => {
    const evaluatePurchaseViability = vi.fn().mockRejectedValue(new Error("unexpected"));
    const registry = new FinanceToolRegistry(createPurchaseViabilityTools({ evaluatePurchaseViability } as unknown as PurchaseViabilityService));

    await expect(registry.execute("evaluate_purchase_viability", { purchaseAmount: "1.00", horizonDays: 7 })).rejects.toThrow("unexpected");
  });
});
