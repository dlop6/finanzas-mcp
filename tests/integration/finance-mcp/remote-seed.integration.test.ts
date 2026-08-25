import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedFinanceDatabase } from "@/database/seed/seed";
import { verifyFinanceSeed } from "@/database/verify";
import { createTestPrisma } from "./test-prisma";

const prisma = createTestPrisma();

beforeEach(async () => {
  await seedFinanceDatabase(prisma);
  await prisma.$transaction([
    prisma.inventoryMovement.deleteMany(), prisma.product.deleteMany(), prisma.receivable.deleteMany(), prisma.debt.deleteMany(),
    prisma.fixedExpense.deleteMany(), prisma.transaction.deleteMany(), prisma.category.deleteMany(), prisma.account.deleteMany(), prisma.business.deleteMany(),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("remote financial seed", () => {
  it("loads and verifies the canonical dataset without a reset", async () => {
    await seedFinanceDatabase(prisma, { target: "remote" });
    await expect(verifyFinanceSeed(prisma)).resolves.toBeUndefined();
  });

  it("rejects a second initialization without changing existing data", async () => {
    await seedFinanceDatabase(prisma, { target: "remote" });
    await expect(seedFinanceDatabase(prisma, { target: "remote" })).rejects.toThrow("must be empty");
    await expect(prisma.business.count()).resolves.toBe(1);
  });
});
