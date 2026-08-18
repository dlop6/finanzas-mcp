import type { PrismaClient } from "@/database/generated/prisma/client";
import { createFinanceRepositories } from "./repositories";
import { CurrentBalanceService, DebtService, ReceivableService, TransactionService } from "./services";
import { createDebtTools } from "./tools/debt-tools";
import { createReceivableTools } from "./tools/receivable-tools";
import { createTransactionTools } from "./tools/transaction-tools";
import { FinanceToolRegistry } from "./tools/registry";

export function createFinanceToolRegistry(prisma: PrismaClient): FinanceToolRegistry {
  const repositories = createFinanceRepositories(prisma);
  const balance = new CurrentBalanceService(repositories.business, repositories.transactions);
  const transactions = new TransactionService(repositories.business, repositories.transactions, balance);
  const debts = new DebtService(repositories.debts);
  const receivables = new ReceivableService(repositories.receivables);
  return new FinanceToolRegistry([...createTransactionTools(transactions), ...createDebtTools(debts), ...createReceivableTools(receivables)]);
}
