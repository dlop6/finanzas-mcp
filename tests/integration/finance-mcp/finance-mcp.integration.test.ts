import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, resetFinanceTestDatabase } from "./fixtures";
import { createTestPrisma } from "./test-prisma";

const prisma = createTestPrisma();
let harness = createHarness(prisma);

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetFinanceTestDatabase(prisma);
  harness = createHarness(prisma);
  await harness.initialize();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function data<T>(result: { structuredContent?: Record<string, unknown> }): T {
  return result.structuredContent as T;
}

describe("Finance MCP against isolated PostgreSQL", () => {
  it("discovers the complete productive catalog", async () => {
    const { tools } = await harness.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "record_income", "record_expense", "record_transactions_batch", "record_mixed_transactions_batch", "list_transactions", "update_transaction", "delete_transaction",
      "record_debt", "list_debts", "update_debt", "mark_debt_paid", "delete_debt",
      "record_receivable", "list_receivables", "update_receivable", "mark_receivable_collected", "delete_receivable",
      "create_product", "list_products", "update_product", "record_inventory_movement", "list_low_stock_products",
      "get_current_balance", "get_cash_flow_summary", "project_cash_flow", "evaluate_purchase_viability",
      "get_transaction_reference_data",
    ]);
    expect(tools.every((tool) => !("isWriteOperation" in tool))).toBe(true);
  });

  it("returns only safe transaction references compatible with the requested type", async () => {
    const income = data<{
      currency: string;
      accounts: Array<{ id: number; name: string; type: string }>;
      categories: Array<{ id: number; name: string; type: string }>;
    }>(await harness.callTool("get_transaction_reference_data", { type: "INCOME" }));

    expect(income.currency).toBe("GTQ");
    expect(income.accounts.map((account) => account.name)).toEqual(["Banco", "Efectivo"]);
    expect(income.categories.map((category) => category.name)).toEqual(["Otros ingresos", "Servicios", "Ventas"]);
    expect(income.categories.every((category) => category.type === "INCOME")).toBe(true);
    expect(income.accounts.every((account) => Object.keys(account).sort().join(",") === "id,name,type")).toBe(true);
  });

  it("persists transactions, filters them, and rejects invalid writes", async () => {
    const initial = await harness.callTool("get_current_balance", {});
    expect(data<{ currentBalance: string }>(initial).currentBalance).toBe("19475.00");

    const income = await harness.callTool("record_income", { accountId: 1, categoryId: 1, amount: "100.50", date: "2026-08-08", description: "  Test income  " });
    expect(data<{ transaction: { description: string | null }; currentBalance: { amount: string } }>(income).transaction.description).toBe("Test income");
    expect(data<{ currentBalance: { amount: string } }>(income).currentBalance.amount).toBe("19575.50");

    const invalid = await harness.callTool("record_income", { accountId: 1, categoryId: 4, amount: "10.00", date: "2026-08-08" });
    expect(invalid.isError).toBe(true);
    expect((await prisma.transaction.count())).toBe(21);

    const listed = await harness.callTool("list_transactions", { startDate: "2026-08-08", endDate: "2026-08-08", type: "INCOME" });
    expect(data<{ transactions: unknown[] }>(listed).transactions).toHaveLength(1);

    const transactionId = data<{ transaction: { id: number } }>(income).transaction.id;
    const updated = await harness.callTool("update_transaction", { transactionId, amount: "120.00" });
    expect(data<{ transaction: { amount: string } }>(updated).transaction.amount).toBe("120.00");
    await harness.callTool("delete_transaction", { transactionId });
    expect(await prisma.transaction.findUnique({ where: { id: transactionId } })).toBeNull();
    expect(data<{ currentBalance: string }>(await harness.callTool("get_current_balance", {})).currentBalance).toBe("19475.00");
  });

  it("records homogeneous and mixed batches atomically and rolls them back when one row is invalid", async () => {
    const before = await prisma.transaction.count();
    const created = await harness.callTool("record_transactions_batch", {
      type: "EXPENSE",
      transactions: [
        { accountId: 1, categoryId: 4, amount: "10.00", date: "2026-08-10", description: "First" },
        { accountId: 2, categoryId: 4, amount: "20.00", date: "2026-08-11", description: "Second" },
      ],
    });
    expect(created.isError).not.toBe(true);
    expect(data<{ currency: string; type: string; transactions: Array<{ amount: string; date: string; description: string | null }> }>(created)).toMatchObject({
      currency: "GTQ", type: "EXPENSE", transactions: [{ amount: "10.00", date: "2026-08-10", description: "First" }, { amount: "20.00", date: "2026-08-11", description: "Second" }],
    });
    expect(await prisma.transaction.count()).toBe(before + 2);

    const rejected = await harness.callTool("record_transactions_batch", {
      type: "EXPENSE",
      transactions: [
        { accountId: 1, categoryId: 4, amount: "30.00", date: "2026-08-12" },
        { accountId: 999, categoryId: 4, amount: "40.00", date: "2026-08-13" },
      ],
    });
    expect(rejected.isError).toBe(true);

    const mixed = await harness.callTool("record_mixed_transactions_batch", {
      transactions: [
        { type: "INCOME", accountId: 1, categoryId: 1, amount: "30.00", date: "2026-08-14", description: "Mixed income" },
        { type: "EXPENSE", accountId: 2, categoryId: 4, amount: "15.00", date: "2026-08-15", description: "Mixed expense" },
      ],
    });
    expect(mixed).toMatchObject({ structuredContent: { currency: "GTQ", transactions: [{ type: "INCOME", amount: "30.00" }, { type: "EXPENSE", amount: "15.00" }] } });

    const rejectedMixed = await harness.callTool("record_mixed_transactions_batch", {
      transactions: [
        { type: "INCOME", accountId: 1, categoryId: 1, amount: "31.00", date: "2026-08-16" },
        { type: "EXPENSE", accountId: 999, categoryId: 4, amount: "16.00", date: "2026-08-17" },
      ],
    });
    expect(rejectedMixed.isError).toBe(true);
    const nonMixed = await harness.callTool("record_mixed_transactions_batch", {
      transactions: [
        { type: "INCOME", accountId: 1, categoryId: 1, amount: "1.00", date: "2026-08-18" },
        { type: "INCOME", accountId: 1, categoryId: 1, amount: "2.00", date: "2026-08-19" },
      ],
    });
    expect(nonMixed.isError).toBe(true);
    expect(await prisma.transaction.count()).toBe(before + 4);
  });

  it("supports debt and receivable lifecycles without creating transactions", async () => {
    const before = await prisma.transaction.count();
    const debt = data<{ debt: { id: number; status: string } }>(await harness.callTool("record_debt", { description: "  Temporary debt ", amount: "50.00", dueDate: "2026-08-12", priority: "LOW" }));
    expect(debt.debt.status).toBe("PENDING");
    await harness.callTool("update_debt", { debtId: debt.debt.id, priority: "HIGH" });
    await harness.callTool("mark_debt_paid", { debtId: debt.debt.id });
    const paidAgain = data<{ debt: { status: string } }>(await harness.callTool("mark_debt_paid", { debtId: debt.debt.id }));
    expect(paidAgain.debt.status).toBe("PAID");
    await harness.callTool("delete_debt", { debtId: debt.debt.id });

    const receivable = data<{ receivable: { id: number; status: string } }>(await harness.callTool("record_receivable", { description: "Temporary receivable", amount: "75.00", expectedDate: "2026-08-15", confidence: "CONFIRMED" }));
    expect(receivable.receivable.status).toBe("PENDING");
    await harness.callTool("mark_receivable_collected", { receivableId: receivable.receivable.id });
    const collectedAgain = data<{ receivable: { status: string } }>(await harness.callTool("mark_receivable_collected", { receivableId: receivable.receivable.id }));
    expect(collectedAgain.receivable.status).toBe("COLLECTED");
    await harness.callTool("delete_receivable", { receivableId: receivable.receivable.id });
    expect(await prisma.transaction.count()).toBe(before);
  });

  it("keeps inventory movements atomic and exposes low stock", async () => {
    const low = data<{ products: Array<{ name: string }> }>(await harness.callTool("list_low_stock_products", {}));
    expect(low.products.map((product) => product.name)).toEqual(["Frijol 1 lb", "Leche 1 L"]);
    const created = data<{ product: { id: number; stock: number } }>(await harness.callTool("create_product", { name: " Temporary product ", stock: 2, unitCost: "1.25", salePrice: "2.00", minimumStock: 2 }));
    expect(created.product.stock).toBe(2);
    const movedIn = data<{ product: { stock: number }; movement: { type: string } }>(await harness.callTool("record_inventory_movement", { productId: created.product.id, type: "IN", quantity: 3, date: "2026-08-08", note: " test " }));
    expect(movedIn.product.stock).toBe(5);
    expect(movedIn.movement.type).toBe("IN");
    await harness.callTool("record_inventory_movement", { productId: created.product.id, type: "OUT", quantity: 2, date: "2026-08-08" });
    const insufficient = await harness.callTool("record_inventory_movement", { productId: created.product.id, type: "OUT", quantity: 99, date: "2026-08-08" });
    expect(insufficient.isError).toBe(true);
    expect((await prisma.product.findUnique({ where: { id: created.product.id } }))?.stock).toBe(3);
  });

  it("returns deterministic balance and period cash flow", async () => {
    const balance = data<{ currentBalance: string; totalIncome: string; totalExpenses: string; accounts: Array<{ name: string; balance: string }> }>(await harness.callTool("get_current_balance", {}));
    expect(balance).toMatchObject({ currentBalance: "19475.00", totalIncome: "13425.00", totalExpenses: "8950.00" });
    expect(balance.accounts).toEqual([
      expect.objectContaining({ name: "Banco", balance: "12700.00" }),
      expect.objectContaining({ name: "Efectivo", balance: "6775.00" }),
    ]);
    const flow = data<{ income: string; expenses: string; netCashFlow: string; transactionCount: number }>(await harness.callTool("get_cash_flow_summary", { startDate: "2026-08-01", endDate: "2026-08-08" }));
    expect(flow).toMatchObject({ income: "3050.00", expenses: "3950.00", netCashFlow: "-900.00", transactionCount: 5 });
  });

  it("projects cash flow and excludes collected or paid obligations", async () => {
    const seven = data<{ confirmedReceivables: string; unconfirmedReceivables: string; fixedExpenses: string; pendingDebts: string; safeProjectedBalance: string; potentialProjectedBalance: string }>(await harness.callTool("project_cash_flow", { horizonDays: 7 }));
    expect(seven).toMatchObject({ confirmedReceivables: "3200.00", unconfirmedReceivables: "0.00", fixedExpenses: "650.00", pendingDebts: "2200.00", safeProjectedBalance: "19825.00", potentialProjectedBalance: "19825.00" });
    const thirty = data<{ confirmedReceivables: string; unconfirmedReceivables: string; fixedExpenses: string; pendingDebts: string; safeProjectedBalance: string; potentialProjectedBalance: string }>(await harness.callTool("project_cash_flow", { horizonDays: 30 }));
    expect(thirty).toMatchObject({ confirmedReceivables: "3200.00", unconfirmedReceivables: "1800.00", fixedExpenses: "3150.00", pendingDebts: "3050.00", safeProjectedBalance: "16475.00", potentialProjectedBalance: "18275.00" });
    await harness.callTool("mark_debt_paid", { debtId: 1 });
    await harness.callTool("mark_receivable_collected", { receivableId: 1 });
    const after = data<{ confirmedReceivables: string; pendingDebts: string }>(await harness.callTool("project_cash_flow", { horizonDays: 30 }));
    expect(after).toMatchObject({ confirmedReceivables: "0.00", pendingDebts: "850.00" });
  });

  it("evaluates purchase viability at inclusive boundaries", async () => {
    const viable = data<{ status: string; maximumSafePurchase: string }>(await harness.callTool("evaluate_purchase_viability", { purchaseAmount: "14975.00", horizonDays: 30 }));
    expect(viable).toMatchObject({ status: "VIABLE", maximumSafePurchase: "14975.00" });
    expect(data<{ status: string }>(await harness.callTool("evaluate_purchase_viability", { purchaseAmount: "15000.00", horizonDays: 30 })).status).toBe("VIABLE_WITH_RISK");
    expect(data<{ status: string }>(await harness.callTool("evaluate_purchase_viability", { purchaseAmount: "16775.00", horizonDays: 30 })).status).toBe("VIABLE_WITH_RISK");
    expect(data<{ status: string }>(await harness.callTool("evaluate_purchase_viability", { purchaseAmount: "16775.01", horizonDays: 30 })).status).toBe("NOT_VIABLE");
    expect((await harness.callTool("evaluate_purchase_viability", { purchaseAmount: "0", horizonDays: 30 })).isError).toBe(true);
    expect((await harness.callTool("evaluate_purchase_viability", { purchaseAmount: "1.00", horizonDays: 14 })).isError).toBe(true);
  });
});
