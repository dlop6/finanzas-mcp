import "dotenv/config";

import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { AccountType, DebtPriority, DebtStatus, InventoryMovementType, ReceivableConfidence, ReceivableStatus, TransactionType } from "../generated/prisma/enums";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CANONICAL_DATE = "2026-08-08";
const SEEDED_AT = new Date(`${CANONICAL_DATE}T00:00:00.000Z`);

type TransactionSeed = {
  date: string;
  account: "Efectivo" | "Banco";
  category: string;
  type: TransactionType;
  amount: string;
};

type ProductSeed = {
  name: string;
  stock: number;
  minimumStock: number;
  unitCost: string;
  salePrice: string;
  incoming: number;
  outgoing: number;
};

const money = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const transactions: TransactionSeed[] = [
  { date: "2026-06-12", account: "Efectivo", category: "Ventas", type: TransactionType.INCOME, amount: "850.00" },
  { date: "2026-06-18", account: "Banco", category: "Servicios", type: TransactionType.INCOME, amount: "1200.00" },
  { date: "2026-06-25", account: "Efectivo", category: "Ventas", type: TransactionType.INCOME, amount: "975.00" },
  { date: "2026-07-02", account: "Banco", category: "Ventas", type: TransactionType.INCOME, amount: "1500.00" },
  { date: "2026-07-08", account: "Efectivo", category: "Ventas", type: TransactionType.INCOME, amount: "1100.00" },
  { date: "2026-07-15", account: "Banco", category: "Servicios", type: TransactionType.INCOME, amount: "1750.00" },
  { date: "2026-07-22", account: "Efectivo", category: "Ventas", type: TransactionType.INCOME, amount: "900.00" },
  { date: "2026-07-29", account: "Banco", category: "Ventas", type: TransactionType.INCOME, amount: "2100.00" },
  { date: "2026-08-03", account: "Efectivo", category: "Ventas", type: TransactionType.INCOME, amount: "1250.00" },
  { date: "2026-08-07", account: "Banco", category: "Servicios", type: TransactionType.INCOME, amount: "1800.00" },
  { date: "2026-06-14", account: "Efectivo", category: "Transporte", type: TransactionType.EXPENSE, amount: "180.00" },
  { date: "2026-06-20", account: "Banco", category: "Inventario", type: TransactionType.EXPENSE, amount: "650.00" },
  { date: "2026-06-28", account: "Efectivo", category: "Servicios básicos", type: TransactionType.EXPENSE, amount: "300.00" },
  { date: "2026-07-05", account: "Banco", category: "Alquiler", type: TransactionType.EXPENSE, amount: "2500.00" },
  { date: "2026-07-10", account: "Efectivo", category: "Marketing", type: TransactionType.EXPENSE, amount: "250.00" },
  { date: "2026-07-18", account: "Banco", category: "Inventario", type: TransactionType.EXPENSE, amount: "900.00" },
  { date: "2026-07-24", account: "Efectivo", category: "Transporte", type: TransactionType.EXPENSE, amount: "220.00" },
  { date: "2026-08-01", account: "Banco", category: "Alquiler", type: TransactionType.EXPENSE, amount: "2500.00" },
  { date: "2026-08-04", account: "Efectivo", category: "Servicios básicos", type: TransactionType.EXPENSE, amount: "350.00" },
  { date: "2026-08-06", account: "Banco", category: "Inventario", type: TransactionType.EXPENSE, amount: "1100.00" },
];

const products: ProductSeed[] = [
  { name: "Arroz 1 lb", stock: 30, minimumStock: 10, unitCost: "5.50", salePrice: "8.00", incoming: 40, outgoing: 10 },
  { name: "Frijol 1 lb", stock: 8, minimumStock: 10, unitCost: "6.00", salePrice: "9.00", incoming: 20, outgoing: 12 },
  { name: "Aceite 1 L", stock: 15, minimumStock: 5, unitCost: "14.00", salePrice: "19.00", incoming: 20, outgoing: 5 },
  { name: "Azúcar 1 lb", stock: 20, minimumStock: 8, unitCost: "5.00", salePrice: "7.50", incoming: 25, outgoing: 5 },
  { name: "Leche 1 L", stock: 4, minimumStock: 6, unitCost: "8.00", salePrice: "11.00", incoming: 12, outgoing: 8 },
];

export type FinanceSeedOptions = {
  target?: "local" | "remote";
};

async function assertRemoteSeedIsEmpty(tx: Prisma.TransactionClient): Promise<void> {
  const counts = await Promise.all([
    tx.business.count(), tx.account.count(), tx.category.count(), tx.transaction.count(), tx.fixedExpense.count(),
    tx.debt.count(), tx.receivable.count(), tx.product.count(), tx.inventoryMovement.count(),
  ]);
  if (counts.some((count) => count !== 0)) {
    throw new Error("Remote financial database must be empty before it can be seeded");
  }
}

export async function seedFinanceDatabase(client: PrismaClient, options: FinanceSeedOptions = {}): Promise<void> {
  const target = options.target ?? "local";
  if (target === "local" && process.env.NODE_ENV === "production") {
    throw new Error("The local financial seed cannot run in production");
  }

  await client.$transaction(async (tx) => {
    if (target === "local") {
      await tx.$executeRaw`
        TRUNCATE TABLE
          "InventoryMovement",
          "Product",
          "Receivable",
          "Debt",
          "FixedExpense",
          "Transaction",
          "Category",
          "Account",
          "Business"
        RESTART IDENTITY CASCADE
      `;
    } else {
      await assertRemoteSeedIsEmpty(tx);
    }

    const business = await tx.business.create({
      data: {
        name: "Tienda Demo",
        currency: "GTQ",
        minimumSafetyBalance: money("1500.00"),
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
    });

    const accountIds = new Map<string, number>();
    for (const account of [
      { name: "Efectivo", type: AccountType.CASH, initialBalance: "3000.00" },
      { name: "Banco", type: AccountType.BANK, initialBalance: "12000.00" },
    ]) {
      const created = await tx.account.create({
        data: {
          businessId: business.id,
          name: account.name,
          type: account.type,
          initialBalance: money(account.initialBalance),
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        },
      });
      accountIds.set(account.name, created.id);
    }

    const categoryIds = new Map<string, number>();
    for (const category of [
      { name: "Ventas", type: TransactionType.INCOME },
      { name: "Servicios", type: TransactionType.INCOME },
      { name: "Otros ingresos", type: TransactionType.INCOME },
      { name: "Inventario", type: TransactionType.EXPENSE },
      { name: "Alquiler", type: TransactionType.EXPENSE },
      { name: "Servicios básicos", type: TransactionType.EXPENSE },
      { name: "Transporte", type: TransactionType.EXPENSE },
      { name: "Marketing", type: TransactionType.EXPENSE },
      { name: "Otros gastos", type: TransactionType.EXPENSE },
    ]) {
      const created = await tx.category.create({
        data: {
          businessId: business.id,
          name: category.name,
          type: category.type,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        },
      });
      categoryIds.set(`${category.type}:${category.name}`, created.id);
    }

    for (const transaction of transactions) {
      await tx.transaction.create({
        data: {
          businessId: business.id,
          accountId: accountIds.get(transaction.account)!,
          categoryId: categoryIds.get(`${transaction.type}:${transaction.category}`)!,
          type: transaction.type,
          amount: money(transaction.amount),
          date: date(transaction.date),
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        },
      });
    }

    for (const fixedExpense of [
      { name: "Alquiler", category: "Alquiler", amount: "2500.00", dueDay: 5 },
      { name: "Internet y energía", category: "Servicios básicos", amount: "650.00", dueDay: 10 },
    ]) {
      await tx.fixedExpense.create({
        data: {
          businessId: business.id,
          categoryId: categoryIds.get(`${TransactionType.EXPENSE}:${fixedExpense.category}`)!,
          name: fixedExpense.name,
          amount: money(fixedExpense.amount),
          dueDay: fixedExpense.dueDay,
          active: true,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        },
      });
    }

    for (const debt of [
      { description: "Proveedor de inventario", amount: "2200.00", dueDate: "2026-08-12", priority: DebtPriority.HIGH },
      { description: "Mantenimiento de equipo", amount: "850.00", dueDate: "2026-08-25", priority: DebtPriority.MEDIUM },
    ]) {
      await tx.debt.create({
        data: {
          businessId: business.id,
          description: debt.description,
          amount: money(debt.amount),
          dueDate: date(debt.dueDate),
          priority: debt.priority,
          status: DebtStatus.PENDING,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        },
      });
    }

    for (const receivable of [
      { description: "Pedido corporativo", amount: "3200.00", expectedDate: "2026-08-15", confidence: ReceivableConfidence.CONFIRMED },
      { description: "Pedido especial", amount: "1800.00", expectedDate: "2026-08-28", confidence: ReceivableConfidence.UNCONFIRMED },
    ]) {
      await tx.receivable.create({
        data: {
          businessId: business.id,
          description: receivable.description,
          amount: money(receivable.amount),
          expectedDate: date(receivable.expectedDate),
          confidence: receivable.confidence,
          status: ReceivableStatus.PENDING,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        },
      });
    }

    for (const product of products) {
      const created = await tx.product.create({
        data: {
          businessId: business.id,
          name: product.name,
          stock: product.stock,
          unitCost: money(product.unitCost),
          salePrice: money(product.salePrice),
          minimumStock: product.minimumStock,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          businessId: business.id,
          productId: created.id,
          type: InventoryMovementType.IN,
          quantity: product.incoming,
          date: date("2026-08-01"),
          note: `Entrada inicial de ${product.name}`,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        },
      });
      await tx.inventoryMovement.create({
        data: {
          businessId: business.id,
          productId: created.id,
          type: InventoryMovementType.OUT,
          quantity: product.outgoing,
          date: date("2026-08-08"),
          note: `Salida de ${product.name}`,
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        },
      });
    }
  }, target === "remote" ? { maxWait: 10_000, timeout: 30_000 } : undefined);
}

async function main(): Promise<void> {
  const { prisma } = await import("../client");
  try {
    await seedFinanceDatabase(prisma);
    console.log(`Deterministic financial seed loaded for ${CANONICAL_DATE}.`);
  } finally {
    await prisma.$disconnect();
  }
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Seed failed";
      console.error(message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted connection]"));
      process.exitCode = 1;
    });
}
