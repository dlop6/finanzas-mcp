import { Prisma } from "@/database/generated/prisma/client";
import type { BusinessRepository } from "@/servers/finance-mcp/repositories";
import { type PurchaseViabilityResult } from "./results";
import type { ProjectionService } from "./projection-service";
import { parseMoney, parseProjectionHorizon } from "./validation";

export class PurchaseViabilityService {
  constructor(
    private readonly business: BusinessRepository,
    private readonly projection: ProjectionService,
  ) {}

  async evaluatePurchaseViability(purchaseAmount: string, horizonDays: number): Promise<PurchaseViabilityResult> {
    const amount = parseMoney(purchaseAmount);
    const horizon = parseProjectionHorizon(horizonDays);
    const [business, projected] = await Promise.all([
      this.business.getActiveBusiness(),
      this.projection.projectCashFlow(horizon),
    ]);
    const safe = new Prisma.Decimal(projected.safeProjectedBalance);
    const potential = new Prisma.Decimal(projected.potentialProjectedBalance);
    const minimum = business.minimumSafetyBalance;
    const safeAfterPurchase = safe.minus(amount);
    const potentialAfterPurchase = potential.minus(amount);
    const maximumCandidate = safe.minus(minimum);
    const maximumSafePurchase = maximumCandidate.lessThan(0) ? new Prisma.Decimal(0) : maximumCandidate;
    const status = safeAfterPurchase.greaterThanOrEqualTo(minimum)
      ? "VIABLE"
      : potentialAfterPurchase.greaterThanOrEqualTo(minimum)
        ? "VIABLE_WITH_RISK"
        : "NOT_VIABLE";

    return {
      currency: projected.currency,
      asOfDate: projected.asOfDate,
      throughDate: projected.throughDate,
      horizonDays: horizon,
      currentBalance: new Prisma.Decimal(projected.currentBalance).toFixed(2),
      purchaseAmount: amount.toFixed(2),
      confirmedReceivables: new Prisma.Decimal(projected.confirmedReceivables).toFixed(2),
      unconfirmedReceivables: new Prisma.Decimal(projected.unconfirmedReceivables).toFixed(2),
      fixedExpenses: new Prisma.Decimal(projected.fixedExpenses).toFixed(2),
      pendingDebts: new Prisma.Decimal(projected.pendingDebts).toFixed(2),
      safeProjectedBalance: safe.toFixed(2),
      potentialProjectedBalance: potential.toFixed(2),
      minimumSafetyBalance: minimum.toFixed(2),
      safeBalanceAfterPurchase: safeAfterPurchase.toFixed(2),
      potentialBalanceAfterPurchase: potentialAfterPurchase.toFixed(2),
      maximumSafePurchase: maximumSafePurchase.toFixed(2),
      status,
    };
  }
}
