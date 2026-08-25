import "dotenv/config";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, type PrismaClient } from "./generated/prisma/client";

const CANONICAL_DATE = new Date("2026-08-08T00:00:00.000Z");
const WINDOW_START = new Date("2026-06-09T00:00:00.000Z");

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function money(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function assertMoney(value: Prisma.Decimal, expected: string, label: string): void {
  assertCondition(value.equals(money(expected)), `${label} expected ${expected}, got ${value.toString()}`);
  assertCondition(value.decimalPlaces() <= 2, `${label} has more than two decimal places`);
}

export async function verifyFinanceSeed(prisma: PrismaClient): Promise<void> {
  const [businessCount, accountCount, categoryCount, transactionCount, fixedExpenseCount, debtCount, pendingDebtCount, receivableCount, productCount, movementCount] = await Promise.all([
    prisma.business.count(),
    prisma.account.count(),
    prisma.category.count(),
    prisma.transaction.count(),
    prisma.fixedExpense.count(),
    prisma.debt.count(),
    prisma.debt.count({ where: { status: "PENDING" } }),
    prisma.receivable.count(),
    prisma.product.count(),
    prisma.inventoryMovement.count(),
  ]);

  assertCondition(businessCount === 1, `Expected 1 Business, got ${businessCount}`);
  assertCondition(accountCount === 2, `Expected 2 Accounts, got ${accountCount}`);
  assertCondition(categoryCount === 9, `Expected 9 Categories, got ${categoryCount}`);
  assertCondition(transactionCount === 20, `Expected 20 Transactions, got ${transactionCount}`);
  assertCondition(fixedExpenseCount === 2, `Expected 2 FixedExpenses, got ${fixedExpenseCount}`);
  assertCondition(debtCount === 2 && pendingDebtCount === 2, "Expected 2 pending Debts");
  assertCondition(receivableCount === 2, `Expected 2 Receivables, got ${receivableCount}`);
  assertCondition(productCount === 5, `Expected 5 Products, got ${productCount}`);
  assertCondition(movementCount === 10, `Expected 10 InventoryMovements, got ${movementCount}`);

  const business = await prisma.business.findFirstOrThrow();
  assertCondition(business.name === "Tienda Demo", "Business name does not match the demo seed");
  assertCondition(business.currency === "GTQ", "Business currency must be GTQ");
  assertMoney(business.minimumSafetyBalance, "1500.00", "minimumSafetyBalance");

  const [accounts, categories, transactions, fixedExpenses, debts, receivables, products, movements] = await Promise.all([
    prisma.account.findMany(),
    prisma.category.findMany(),
    prisma.transaction.findMany(),
    prisma.fixedExpense.findMany(),
    prisma.debt.findMany(),
    prisma.receivable.findMany(),
    prisma.product.findMany({ include: { movements: true } }),
    prisma.inventoryMovement.findMany(),
  ]);

  const relatedBusinessIds = [
    ...accounts.map((item) => item.businessId),
    ...categories.map((item) => item.businessId),
    ...transactions.map((item) => item.businessId),
    ...fixedExpenses.map((item) => item.businessId),
    ...debts.map((item) => item.businessId),
    ...receivables.map((item) => item.businessId),
    ...products.map((item) => item.businessId),
    ...movements.map((item) => item.businessId),
  ];
  assertCondition(new Set(relatedBusinessIds).size === 1 && relatedBusinessIds[0] === business.id, "Entities must belong to the only Business");

  const confirmed = receivables.filter((item) => item.confidence === "CONFIRMED");
  const unconfirmed = receivables.filter((item) => item.confidence === "UNCONFIRMED");
  assertCondition(confirmed.length === 1 && unconfirmed.length === 1, "Receivables must include both confidence levels");

  let income = money("0.00");
  let expense = money("0.00");
  for (const transaction of transactions) {
    assertCondition(transaction.date >= WINDOW_START && transaction.date <= CANONICAL_DATE, `Transaction ${transaction.id} is outside the canonical 60-day window`);
    assertCondition(transaction.amount.decimalPlaces() <= 2, `Transaction ${transaction.id} has more than two decimal places`);
    if (transaction.type === "INCOME") {
      income = income.add(transaction.amount);
    } else {
      expense = expense.add(transaction.amount);
    }
  }
  assertMoney(income, "13425.00", "income total");
  assertMoney(expense, "8950.00", "expense total");

  const initialBalance = accounts.reduce((total, account) => total.add(account.initialBalance), money("0.00"));
  const derivedBalance = initialBalance.add(income).sub(expense);
  assertMoney(derivedBalance, "19475.00", "derived balance");

  assertCondition(products.some((product) => product.stock < product.minimumStock), "At least one product must be below minimumStock");
  for (const product of products) {
    const incoming = product.movements.filter((movement) => movement.type === "IN").reduce((total, movement) => total + movement.quantity, 0);
    const outgoing = product.movements.filter((movement) => movement.type === "OUT").reduce((total, movement) => total + movement.quantity, 0);
    assertCondition(incoming - outgoing === product.stock, `Inventory movements do not match stock for ${product.name}`);
  }

  const numericColumns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string; numeric_scale: number }>>`
    SELECT table_name, column_name, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'numeric'
      AND column_name IN ('minimumSafetyBalance', 'initialBalance', 'amount', 'unitCost', 'salePrice')
  `;
  assertCondition(numericColumns.length === 8, "Expected all monetary columns to use numeric precision");
  assertCondition(numericColumns.every((column) => column.numeric_scale === 2), "Monetary columns must use scale 2");
}

async function main(): Promise<void> {
  const { prisma } = await import("./client");
  try {
    await verifyFinanceSeed(prisma);
    console.log("Financial seed verification passed for Tienda Demo (2026-08-08).");
  } finally {
    await prisma.$disconnect();
  }
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Database verification failed";
    console.error(message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted connection]"));
    process.exitCode = 1;
  });
}
