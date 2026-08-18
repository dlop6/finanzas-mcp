import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@/database/generated/prisma/client";
import {
  ActiveBusinessAmbiguousError,
  ActiveBusinessNotFoundError,
  EntityNotFoundError,
  FinanceRepositoryError,
  InventoryIntegrityError,
  createFinanceRepositories,
} from "@/servers/finance-mcp/repositories";

const money = new Prisma.Decimal("12.50");
const business = { id: 1, name: "Tienda Demo", currency: "GTQ", minimumSafetyBalance: money, createdAt: new Date(), updatedAt: new Date() };
const account = { id: 2, businessId: 1, name: "Efectivo", type: "CASH", initialBalance: money, createdAt: new Date(), updatedAt: new Date() };
const category = { id: 3, businessId: 1, name: "Ventas", type: "INCOME", createdAt: new Date(), updatedAt: new Date() };
const transaction = { id: 4, businessId: 1, accountId: 2, categoryId: 3, type: "INCOME", amount: money, date: new Date("2026-08-08"), description: null, createdAt: new Date(), updatedAt: new Date() };
const debt = { id: 5, businessId: 1, description: "Debt", amount: money, dueDate: new Date("2026-08-12"), priority: "HIGH", status: "PENDING", createdAt: new Date(), updatedAt: new Date() };
const receivable = { id: 6, businessId: 1, description: "Receivable", amount: money, expectedDate: new Date("2026-08-15"), confidence: "CONFIRMED", status: "PENDING", createdAt: new Date(), updatedAt: new Date() };
const product = { id: 7, businessId: 1, name: "Arroz", stock: 10, unitCost: money, salePrice: money, minimumStock: 10, createdAt: new Date(), updatedAt: new Date() };
const movement = { id: 8, businessId: 1, productId: 7, type: "IN", quantity: 2, date: new Date("2026-08-08"), note: null, createdAt: new Date(), updatedAt: new Date() };

function createPrisma() {
  const prisma = {
    business: { findMany: vi.fn().mockResolvedValue([business]) },
    account: { findMany: vi.fn().mockResolvedValue([account]), findFirst: vi.fn().mockResolvedValue(account) },
    category: { findMany: vi.fn().mockResolvedValue([category]), findFirst: vi.fn().mockResolvedValue(category) },
    fixedExpense: { findMany: vi.fn().mockResolvedValue([]) },
    transaction: { findMany: vi.fn().mockResolvedValue([transaction]), findFirst: vi.fn().mockResolvedValue(transaction), create: vi.fn().mockResolvedValue(transaction), update: vi.fn().mockResolvedValue(transaction), delete: vi.fn().mockResolvedValue(transaction) },
    debt: { findMany: vi.fn().mockResolvedValue([debt]), findFirst: vi.fn().mockResolvedValue(debt), create: vi.fn().mockResolvedValue(debt), update: vi.fn().mockResolvedValue(debt), delete: vi.fn().mockResolvedValue(debt) },
    receivable: { findMany: vi.fn().mockResolvedValue([receivable]), findFirst: vi.fn().mockResolvedValue(receivable), create: vi.fn().mockResolvedValue(receivable), update: vi.fn().mockResolvedValue(receivable), delete: vi.fn().mockResolvedValue(receivable) },
    product: { findMany: vi.fn().mockResolvedValue([product]), findFirst: vi.fn().mockResolvedValue(product), create: vi.fn().mockResolvedValue(product), update: vi.fn().mockResolvedValue(product) },
    inventoryMovement: { findMany: vi.fn().mockResolvedValue([movement]), findFirst: vi.fn().mockResolvedValue(movement), create: vi.fn().mockResolvedValue(movement), delete: vi.fn().mockResolvedValue(movement) },
    $transaction: vi.fn(async (callback: (transactionClient: unknown) => Promise<unknown>) => callback(prisma)),
  };
  return prisma as unknown as PrismaClient & typeof prisma;
}

describe("Finance repositories", () => {
  it("requires exactly one active business", async () => {
    const none = createPrisma();
    none.business.findMany.mockResolvedValueOnce([]);
    await expect(createFinanceRepositories(none).business.getActiveBusiness()).rejects.toBeInstanceOf(ActiveBusinessNotFoundError);

    const many = createPrisma();
    many.business.findMany.mockResolvedValueOnce([business, { ...business, id: 2 }]);
    await expect(createFinanceRepositories(many).business.getActiveBusiness()).rejects.toBeInstanceOf(ActiveBusinessAmbiguousError);
  });

  it("queries catalog entities only within the active business and in deterministic order", async () => {
    const prisma = createPrisma();
    const repositories = createFinanceRepositories(prisma);

    await repositories.business.listAccounts();
    await repositories.business.listCategories("INCOME");
    await repositories.business.listFixedExpenses(true);

    expect(prisma.account.findMany).toHaveBeenCalledWith({ where: { businessId: 1 }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    expect(prisma.category.findMany).toHaveBeenCalledWith({ where: { businessId: 1, type: "INCOME" }, orderBy: [{ type: "asc" }, { name: "asc" }, { id: "asc" }] });
    expect(prisma.fixedExpense.findMany).toHaveBeenCalledWith({ where: { businessId: 1, active: true }, orderBy: [{ dueDay: "asc" }, { name: "asc" }, { id: "asc" }] });
  });

  it("creates, filters, updates and deletes transactions without converting decimals", async () => {
    const prisma = createPrisma();
    const repository = createFinanceRepositories(prisma).transactions;

    const created = await repository.create({ accountId: 2, categoryId: 3, type: "INCOME", amount: money, date: transaction.date });
    await repository.list({ startDate: new Date("2026-08-01"), endDate: new Date("2026-08-08"), type: "INCOME", accountId: 2, categoryId: 3 });
    await repository.update(4, { description: "corrected" });
    await repository.delete(4);

    expect(created.amount).toBeInstanceOf(Prisma.Decimal);
    expect(prisma.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ businessId: 1, amount: money }) });
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: 1, type: "INCOME", accountId: 2, categoryId: 3 }), orderBy: [{ date: "desc" }, { id: "desc" }] }));
    expect(prisma.transaction.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { description: "corrected" } });
    expect(prisma.transaction.delete).toHaveBeenCalledWith({ where: { id: 4 } });
  });

  it("provides scoped lifecycle operations for debts and receivables", async () => {
    const prisma = createPrisma();
    const repositories = createFinanceRepositories(prisma);

    await repositories.debts.create({ description: "Debt", amount: money, dueDate: debt.dueDate, priority: "HIGH" });
    await repositories.debts.list({ status: "PENDING", priority: "HIGH", dueBefore: debt.dueDate });
    await repositories.debts.updateStatus(5, "PAID");
    await repositories.debts.delete(5);
    await repositories.receivables.create({ description: "Receivable", amount: money, expectedDate: receivable.expectedDate, confidence: "CONFIRMED" });
    await repositories.receivables.list({ status: "PENDING", confidence: "CONFIRMED", dueBefore: receivable.expectedDate });
    await repositories.receivables.updateStatus(6, "COLLECTED");
    await repositories.receivables.delete(6);

    expect(prisma.debt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: 1, status: "PENDING", priority: "HIGH" }) }));
    expect(prisma.debt.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: "PAID" } });
    expect(prisma.receivable.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: 1, status: "PENDING", confidence: "CONFIRMED" }) }));
    expect(prisma.receivable.update).toHaveBeenCalledWith({ where: { id: 6 }, data: { status: "COLLECTED" } });
  });

  it("records and reverses inventory movements atomically", async () => {
    const prisma = createPrisma();
    const inventory = createFinanceRepositories(prisma).inventory;

    await inventory.recordMovement({ productId: 7, type: "IN", quantity: 2, date: movement.date });
    await inventory.deleteMovement(8);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.product.update).toHaveBeenNthCalledWith(1, { where: { id: 7 }, data: { stock: { increment: 2 } } });
    expect(prisma.product.update).toHaveBeenNthCalledWith(2, { where: { id: 7 }, data: { stock: { increment: -2 } } });
    expect(prisma.inventoryMovement.create).toHaveBeenCalledWith({ data: expect.objectContaining({ businessId: 1, productId: 7 }) });
    expect(prisma.inventoryMovement.delete).toHaveBeenCalledWith({ where: { id: 8 } });
  });

  it("rejects insufficient stock and missing scoped records without leaking persistence details", async () => {
    const insufficient = createPrisma();
    insufficient.product.findFirst.mockResolvedValueOnce({ ...product, stock: 1 });
    await expect(createFinanceRepositories(insufficient).inventory.recordMovement({ productId: 7, type: "OUT", quantity: 2, date: movement.date })).rejects.toBeInstanceOf(InventoryIntegrityError);
    expect(insufficient.inventoryMovement.create).not.toHaveBeenCalled();

    const missing = createPrisma();
    missing.debt.findFirst.mockResolvedValueOnce(null);
    await expect(createFinanceRepositories(missing).debts.get(999)).rejects.toBeInstanceOf(EntityNotFoundError);

    const failing = createPrisma();
    failing.product.findMany.mockRejectedValueOnce(new Error("postgresql://user:password@localhost:5434/finance"));
    await expect(createFinanceRepositories(failing).inventory.listProducts()).rejects.toMatchObject({
      name: FinanceRepositoryError.name,
      message: "The financial data could not be accessed.",
    });
  });
});
