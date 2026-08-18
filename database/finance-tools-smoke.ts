import { startFinanceMcpSessionLocal } from "@/host/mcp-clients/finance-mcp-local";

async function main(): Promise<void> {
  const client = await startFinanceMcpSessionLocal({ onStderr: () => undefined });
  let incomeId: number | undefined;
  let expenseId: number | undefined;
  let debtId: number | undefined;
  try {
    const tools = await client.toolsList();
    const names = tools.tools.map((tool) => tool.name);
    const expected = ["record_income", "record_expense", "list_transactions", "update_transaction", "delete_transaction", "record_debt", "list_debts", "update_debt", "mark_debt_paid", "delete_debt"];
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
    await client.toolsCall("delete_transaction", { transactionId: expenseId }); expenseId = undefined;
    const deleted = await client.toolsCall("delete_transaction", { transactionId: incomeId }); incomeId = undefined;
    if ((deleted.structuredContent as { currentBalance: { amount: string } }).currentBalance.amount !== "19475.00") throw new Error("Cleanup did not restore the balance.");
    console.info("Finance transaction tools smoke check passed.");
  } finally {
    if (debtId !== undefined) await client.toolsCall("delete_debt", { debtId }).catch(() => undefined);
    if (expenseId !== undefined) await client.toolsCall("delete_transaction", { transactionId: expenseId }).catch(() => undefined);
    if (incomeId !== undefined) await client.toolsCall("delete_transaction", { transactionId: incomeId }).catch(() => undefined);
    await client.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Finance tools smoke check failed.");
  process.exitCode = 1;
});
