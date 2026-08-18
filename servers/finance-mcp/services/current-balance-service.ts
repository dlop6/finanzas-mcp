import { Prisma } from "@/database/generated/prisma/client";
import type { BusinessRepository, TransactionRepository } from "@/servers/finance-mcp/repositories";
import { moneyResult, type MoneyResult } from "./results";

export class CurrentBalanceService {
  constructor(private readonly business: BusinessRepository, private readonly transactions: TransactionRepository) {}

  async getCurrentBalance(): Promise<MoneyResult> {
    const [activeBusiness, accounts, transactions] = await Promise.all([
      this.business.getActiveBusiness(), this.business.listAccounts(), this.transactions.list(),
    ]);
    let balance = accounts.reduce((total, account) => total.plus(account.initialBalance), new Prisma.Decimal(0));
    for (const transaction of transactions) {
      balance = transaction.type === "INCOME" ? balance.plus(transaction.amount) : balance.minus(transaction.amount);
    }
    return moneyResult(balance, activeBusiness.currency);
  }
}
