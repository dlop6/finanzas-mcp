import { seedFinanceDatabase } from "@/database/seed/seed";
import type { PrismaClient } from "@/database/generated/prisma/client";
import { FinanceMcpTestHarness } from "./harness";

export const fixedFinanceClock = { todayUtc: () => new Date("2026-08-08T00:00:00.000Z") };

export async function resetFinanceTestDatabase(prisma: PrismaClient): Promise<void> {
  await seedFinanceDatabase(prisma);
}

export function createHarness(prisma: PrismaClient): FinanceMcpTestHarness {
  return new FinanceMcpTestHarness(prisma, fixedFinanceClock);
}
