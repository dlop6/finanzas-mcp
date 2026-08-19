import { startFinanceMcpSessionLocal } from "@/host/mcp-clients/finance-mcp-local";
import { prisma } from "@/database/client";

async function main(): Promise<void> {
  const client = await startFinanceMcpSessionLocal({ onStderr: () => undefined });
  let incomeId: number | undefined;
  let expenseId: number | undefined;
  let debtId: number | undefined;
  let receivableId: number | undefined;
  let productId: number | undefined;
  try {
    const tools = await client.toolsList();
    const names = tools.tools.map((tool) => tool.name);
    const expected = ["record_income", "record_expense", "list_transactions", "update_transaction", "delete_transaction", "record_debt", "list_debts", "update_debt", "mark_debt_paid", "delete_debt", "record_receivable", "list_receivables", "update_receivable", "mark_receivable_collected", "delete_receivable", "create_product", "list_products", "update_product", "record_inventory_movement", "list_low_stock_products", "get_current_balance", "get_cash_flow_summary", "project_cash_flow"];
    if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error("Unexpected Finance MCP tool registry.");

    const income = await client.toolsCall("record_income", { accountId: 1, categoryId: 1, amount: "100.00", date: "2026-08-08", description: "Smoke income" });
    incomeId = ((income.structuredContent as { transaction: { id: number } }).transaction.id);
    if ((income.structuredContent as { currentBalance: { amount: string } }).currentBalance.amount !== "19575.00") throw new Error("Income did not update the balance.");

    const expense = await client.toolsCall("record_expense", { accountId: 1, categoryId: 4, amount: "40.00", date: "2026-08-08", description: "Smoke expense" });
    expenseId = ((expense.structuredContent as { transaction: { id: number } }).transaction.id);
    if ((expense.structuredContent as { currentBalance: { amount: string } }).currentBalance.amount !== "19535.00") throw new Error("Expense did not update the balance.");

    const listed = await client.toolsCall("list_transactions", { type: "INCOME", accountId: 1 });
    if (!Array.isArray((listed.structuredContent as { transactions: unknown[] }).transactions)) throw new Error("List did not return transactions.");

    await client.toolsCall("update_transaction", { transactionId: incomeId, description: "Updated smoke income" });
    const debt = await client.toolsCall("record_debt", { description: "Smoke debt", amount: "10.00", dueDate: "2026-08-20", priority: "LOW" });
    debtId = (debt.structuredContent as { debt: { id: number } }).debt.id;
    await client.toolsCall("mark_debt_paid", { debtId });
    await client.toolsCall("delete_debt", { debtId }); debtId = undefined;
    const receivable = await client.toolsCall("record_receivable", { description: "Smoke receivable", amount: "10.00", expectedDate: "2026-08-20", confidence: "CONFIRMED" });
    receivableId = (receivable.structuredContent as { receivable: { id: number } }).receivable.id;
    await client.toolsCall("mark_receivable_collected", { receivableId });
    await client.toolsCall("delete_receivable", { receivableId }); receivableId = undefined;
    const lowStock = await client.toolsCall("list_low_stock_products");
    const lowStockNames = (lowStock.structuredContent as { products: Array<{ name: string }> }).products.map((product) => product.name);
    if (!lowStockNames.includes("Frijol 1 lb") || !lowStockNames.includes("Leche 1 L")) throw new Error("Expected seed low-stock products.");
    const balance = await client.toolsCall("get_current_balance");
    if ((balance.structuredContent as { currentBalance: string }).currentBalance !== "19535.00") throw new Error("Unexpected current balance.");
    const summary = await client.toolsCall("get_cash_flow_summary", { startDate: "2026-08-01", endDate: "2026-08-08" });
    if ((summary.structuredContent as { netCashFlow: string; transactionCount: number }).netCashFlow !== "-840.00" || (summary.structuredContent as { transactionCount: number }).transactionCount !== 7) throw new Error("Unexpected cash-flow summary.");
    const projection = await client.toolsCall("project_cash_flow", { horizonDays: 7 });
    const projected = projection.structuredContent as { currentBalance: string; confirmedReceivables: string; unconfirmedReceivables: string; fixedExpenses: string; pendingDebts: string; safeProjectedBalance: string; potentialProjectedBalance: string };
    if (new Set([projected.currentBalance, projected.confirmedReceivables, projected.unconfirmedReceivables, projected.fixedExpenses, projected.pendingDebts, projected.safeProjectedBalance, projected.potentialProjectedBalance]).size === 0) throw new Error("Projection did not return monetary totals.");
    const product = await client.toolsCall("create_product", { name: `Smoke inventory ${process.pid}`, stock: 2, unitCost: "1.00", salePrice: "2.00", minimumStock: 3 });
    productId = (product.structuredContent as { product: { id: number } }).product.id;
    const entered = await client.toolsCall("record_inventory_movement", { productId, type: "IN", quantity: 3, date: "2026-08-08", note: "Smoke entry" });
    if ((entered.structuredContent as { product: { stock: number } }).product.stock !== 5) throw new Error("Inventory entry did not update stock.");
    const exited = await client.toolsCall("record_inventory_movement", { productId, type: "OUT", quantity: 2, date: "2026-08-08", note: "Smoke exit" });
    if ((exited.structuredContent as { product: { stock: number } }).product.stock !== 3) throw new Error("Inventory exit did not update stock.");
    await expectToolError(client.toolsCall("record_inventory_movement", { productId, type: "OUT", quantity: 4, date: "2026-08-08" }));
    await client.toolsCall("delete_transaction", { transactionId: expenseId }); expenseId = undefined;
    const deleted = await client.toolsCall("delete_transaction", { transactionId: incomeId }); incomeId = undefined;
    if ((deleted.structuredContent as { currentBalance: { amount: string } }).currentBalance.amount !== "19475.00") throw new Error("Cleanup did not restore the balance.");
    console.info("Finance tools smoke check passed.");
  } finally {
    if (receivableId !== undefined) await client.toolsCall("delete_receivable", { receivableId }).catch(() => undefined);
    if (debtId !== undefined) await client.toolsCall("delete_debt", { debtId }).catch(() => undefined);
    if (expenseId !== undefined) await client.toolsCall("delete_transaction", { transactionId: expenseId }).catch(() => undefined);
    if (incomeId !== undefined) await client.toolsCall("delete_transaction", { transactionId: incomeId }).catch(() => undefined);
    await client.close();
    if (productId !== undefined) {
      await prisma.$transaction([
        prisma.inventoryMovement.deleteMany({ where: { productId } }),
        prisma.product.delete({ where: { id: productId } }),
      ]).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Finance tools smoke check failed.");
  process.exitCode = 1;
});

async function expectToolError(result: Promise<unknown>): Promise<void> {
  const response = await result as { isError?: boolean };
  if (response.isError !== true) throw new Error("Expected tool error.");
}
