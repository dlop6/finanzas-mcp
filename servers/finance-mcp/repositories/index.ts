import type { PrismaClient } from "@/database/generated/prisma/client";

import { BusinessRepository } from "./business-repository";
import { DebtRepository } from "./debt-repository";
import { InventoryRepository } from "./inventory-repository";
import { ReceivableRepository } from "./receivable-repository";
import { TransactionRepository } from "./transaction-repository";
import { SaleRepository } from "./sale-repository";

export { BusinessRepository } from "./business-repository";
export { DebtRepository } from "./debt-repository";
export * from "./errors";
export { InventoryRepository } from "./inventory-repository";
export { ReceivableRepository } from "./receivable-repository";
export { TransactionRepository } from "./transaction-repository";
export { SaleRepository } from "./sale-repository";
export type * from "./sale-repository";
export type * from "./debt-repository";
export type * from "./inventory-repository";
export type * from "./receivable-repository";
export type * from "./transaction-repository";

export type FinanceRepositories = {
  business: BusinessRepository;
  transactions: TransactionRepository;
  debts: DebtRepository;
  receivables: ReceivableRepository;
  inventory: InventoryRepository;
  sales: SaleRepository;
};

export function createFinanceRepositories(prisma: PrismaClient): FinanceRepositories {
  return {
    business: new BusinessRepository(prisma),
    transactions: new TransactionRepository(prisma),
    debts: new DebtRepository(prisma),
    receivables: new ReceivableRepository(prisma),
    inventory: new InventoryRepository(prisma),
    sales: new SaleRepository(prisma),
  };
}
