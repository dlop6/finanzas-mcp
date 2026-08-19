import { Prisma } from "@/database/generated/prisma/client";
import type { BusinessRepository } from "@/servers/finance-mcp/repositories";
import type { CashFlowProjectionResult, ProjectionService } from "@/servers/finance-mcp/services";
import { PurchaseViabilityService } from "@/servers/finance-mcp/services";
import { describe, expect, it, vi } from "vitest";

const projection: CashFlowProjectionResult = {
  currency: "GTQ" as const,
  asOfDate: "2026-08-08",
  throughDate: "2026-09-07",
  horizonDays: 30 as const,
  currentBalance: "19475.00",
  confirmedReceivables: "3200.00",
  unconfirmedReceivables: "1800.00",
  fixedExpenses: "3150.00",
  pendingDebts: "3050.00",
  safeProjectedBalance: "16475.00",
  potentialProjectedBalance: "18275.00",
  details: {
    confirmedReceivables: [],
    unconfirmedReceivables: [],
    fixedExpenses: [],
    pendingDebts: [],
  },
};

function createService(
  minimumSafetyBalance = "1500.00",
  projected: CashFlowProjectionResult = projection,
): { service: PurchaseViabilityService; projectCashFlow: ReturnType<typeof vi.fn>; getActiveBusiness: ReturnType<typeof vi.fn> } {
  const projectCashFlow = vi.fn().mockResolvedValue(projected);
  const getActiveBusiness = vi.fn().mockResolvedValue({
    id: 1,
    currency: "GTQ",
    minimumSafetyBalance: new Prisma.Decimal(minimumSafetyBalance),
  });

  return {
    service: new PurchaseViabilityService(
      { getActiveBusiness } as unknown as BusinessRepository,
      { projectCashFlow } as unknown as ProjectionService,
    ),
    projectCashFlow,
    getActiveBusiness,
  };
}

describe("PurchaseViabilityService", () => {
  it("returns VIABLE when the safe balance exactly reaches the minimum", async () => {
    const { service, projectCashFlow, getActiveBusiness } = createService();

    await expect(service.evaluatePurchaseViability("14975.00", 30)).resolves.toMatchObject({
      currency: "GTQ",
      asOfDate: "2026-08-08",
      throughDate: "2026-09-07",
      horizonDays: 30,
      purchaseAmount: "14975.00",
      minimumSafetyBalance: "1500.00",
      safeBalanceAfterPurchase: "1500.00",
      potentialBalanceAfterPurchase: "3300.00",
      maximumSafePurchase: "14975.00",
      status: "VIABLE",
    });
    expect(projectCashFlow).toHaveBeenCalledWith(30);
    expect(getActiveBusiness).toHaveBeenCalledTimes(1);
  });

  it("returns VIABLE_WITH_RISK only when the potential balance reaches the minimum", async () => {
    const { service } = createService();

    await expect(service.evaluatePurchaseViability("15000.00", 30)).resolves.toMatchObject({
      safeBalanceAfterPurchase: "1475.00",
      potentialBalanceAfterPurchase: "3275.00",
      status: "VIABLE_WITH_RISK",
    });
    await expect(service.evaluatePurchaseViability("16775.00", 30)).resolves.toMatchObject({
      potentialBalanceAfterPurchase: "1500.00",
      status: "VIABLE_WITH_RISK",
    });
  });

  it("returns NOT_VIABLE when neither projection reaches the minimum", async () => {
    const { service } = createService();

    await expect(service.evaluatePurchaseViability("16775.01", 30)).resolves.toMatchObject({
      potentialBalanceAfterPurchase: "1499.99",
      status: "NOT_VIABLE",
    });
  });

  it("limits the maximum safe purchase to zero", async () => {
    const projected = { ...projection, safeProjectedBalance: "1200.00", potentialProjectedBalance: "1400.00" };
    const { service } = createService("1500.00", projected);

    await expect(service.evaluatePurchaseViability("1.00", 30)).resolves.toMatchObject({
      maximumSafePurchase: "0.00",
      status: "NOT_VIABLE",
    });
  });

  it.each([
    ["0", 30],
    ["-1.00", 30],
    ["1.234", 30],
    ["1.00", 14],
  ])("rejects invalid purchase inputs %s / %s", async (purchaseAmount, horizonDays) => {
    const { service, projectCashFlow } = createService();

    await expect(service.evaluatePurchaseViability(purchaseAmount, horizonDays)).rejects.toMatchObject({
      name: "FinanceDomainError",
    });
    expect(projectCashFlow).not.toHaveBeenCalled();
  });

  it("reads fresh projection and business values on every evaluation", async () => {
    const { service, projectCashFlow, getActiveBusiness } = createService();

    await service.evaluatePurchaseViability("1.00", 7);
    await service.evaluatePurchaseViability("1.00", 30);

    expect(projectCashFlow).toHaveBeenNthCalledWith(1, 7);
    expect(projectCashFlow).toHaveBeenNthCalledWith(2, 30);
    expect(getActiveBusiness).toHaveBeenCalledTimes(2);
  });

  it("preserves the requested seven-day horizon", async () => {
    const { service } = createService(undefined, { ...projection, horizonDays: 7 });

    await expect(service.evaluatePurchaseViability("1.00", 7)).resolves.toMatchObject({ horizonDays: 7 });
  });

  it("reflects updated projections and minimum balances without caching", async () => {
    const { service, projectCashFlow, getActiveBusiness } = createService();

    await expect(service.evaluatePurchaseViability("1.00", 30)).resolves.toMatchObject({ status: "VIABLE" });
    projectCashFlow.mockResolvedValue({ ...projection, safeProjectedBalance: "1000.00", potentialProjectedBalance: "2000.00" });
    getActiveBusiness.mockResolvedValue({ id: 1, currency: "GTQ", minimumSafetyBalance: new Prisma.Decimal("1500.00") });

    await expect(service.evaluatePurchaseViability("1.00", 30)).resolves.toMatchObject({ status: "VIABLE_WITH_RISK", maximumSafePurchase: "0.00" });
  });
});
