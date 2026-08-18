import "dotenv/config";
import assert from "node:assert/strict";

import { Prisma } from "./generated/prisma/client";
import { createFinanceRepositories } from "../servers/finance-mcp/repositories/index";
import { prisma } from "./client";

async function main(): Promise<void> {
  const repositories = createFinanceRepositories(prisma);
  const business = await repositories.business.getActiveBusiness();
  const [accounts, categories, fixedExpenses, transactions, debts, receivables, products, movements] = await Promise.all([
    repositories.business.listAccounts(),
    repositories.business.listCategories(),
    repositories.business.listFixedExpenses(),
    repositories.transactions.list(),
    repositories.debts.list(),
    repositories.receivables.list(),
    repositories.inventory.listProducts(),
    repositories.inventory.listMovements(),
  ]);

  assert.equal(accounts.length, 2, "Expected two accounts");
  assert.equal(categories.length, 9, "Expected nine categories");
  assert.equal(fixedExpenses.length, 2, "Expected two fixed expenses");
  assert.equal(transactions.length, 20, "Expected twenty transactions");
  assert.equal(debts.length, 2, "Expected two debts");
  assert.equal(receivables.length, 2, "Expected two receivables");
  assert.equal(products.length, 5, "Expected five products");
  assert.equal(movements.length, 10, "Expected ten inventory movements");
  assert(transactions.every((item) => item.businessId === business.id), "Transactions must belong to the active business");
  assert(debts.every((item) => item.businessId === business.id), "Debts must belong to the active business");
  assert(receivables.every((item) => item.businessId === business.id), "Receivables must belong to the active business");
  assert(products.every((item) => item.businessId === business.id), "Products must belong to the active business");
  assert(movements.every((item) => item.businessId === business.id), "Movements must belong to the active business");
  assert(transactions.every((item) => item.amount instanceof Prisma.Decimal), "Transaction amounts must remain Decimal values");
  assert(products.some((item) => item.stock <= item.minimumStock), "Expected at least one low-stock product");

  await repositories.transactions.list({ type: "INCOME" });
  await repositories.debts.list({ status: "PENDING" });
  await repositories.receivables.list({ confidence: "CONFIRMED" });
  await repositories.inventory.listProducts(true);
  await repositories.inventory.listMovements({ productId: products[0].id });

  console.log("Finance repository smoke check passed.");
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Finance repository smoke check failed.";
    console.error(message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted connection]"));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
