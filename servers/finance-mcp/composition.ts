import type { PrismaClient } from "@/database/generated/prisma/client";
import { createFinanceRepositories } from "./repositories";
import { CashFlowService, CurrentBalanceService, DebtService, InventoryService, ProjectionService, PurchaseViabilityService, ReceivableService, TransactionService } from "./services";
import { createDebtTools } from "./tools/debt-tools";
import { createReceivableTools } from "./tools/receivable-tools";
import { createInventoryTools } from "./tools/inventory-tools";
import { createCashFlowTools } from "./tools/cash-flow-tools";
import { createProjectionTools } from "./tools/projection-tools";
import { createPurchaseViabilityTools } from "./tools/purchase-viability-tools";
import { createTransactionTools } from "./tools/transaction-tools";
import { FinanceToolRegistry } from "./tools/registry";

export function createFinanceToolRegistry(prisma: PrismaClient): FinanceToolRegistry {
  const repositories = createFinanceRepositories(prisma);
  const balance = new CurrentBalanceService(repositories.business, repositories.transactions);
  const transactions = new TransactionService(repositories.business, repositories.transactions, balance);
  const debts = new DebtService(repositories.debts);
  const receivables = new ReceivableService(repositories.receivables);
  const inventory = new InventoryService(repositories.inventory);
  const cashFlow = new CashFlowService(repositories.transactions, balance);
  const projection = new ProjectionService(repositories.business, repositories.debts, repositories.receivables, balance);
  const purchaseViability = new PurchaseViabilityService(repositories.business, projection);
  return new FinanceToolRegistry([...createTransactionTools(transactions), ...createDebtTools(debts), ...createReceivableTools(receivables), ...createInventoryTools(inventory), ...createCashFlowTools(balance, cashFlow), ...createProjectionTools(projection), ...createPurchaseViabilityTools(purchaseViability)]);
}
