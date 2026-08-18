import type { PrismaClient } from "@/database/generated/prisma/client";
import { createFinanceRepositories } from "./repositories";
import { CurrentBalanceService, TransactionService } from "./services";
import { createTransactionTools } from "./tools/transaction-tools";
import { FinanceToolRegistry } from "./tools/registry";

export function createFinanceToolRegistry(prisma: PrismaClient): FinanceToolRegistry {
  const repositories = createFinanceRepositories(prisma);
  const balance = new CurrentBalanceService(repositories.business, repositories.transactions);
  const transactions = new TransactionService(repositories.business, repositories.transactions, balance);
  return new FinanceToolRegistry(createTransactionTools(transactions));
}
