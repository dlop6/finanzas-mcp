import { Prisma } from "@/database/generated/prisma/client";
import type { BusinessRepository, TransactionRepository } from "@/servers/finance-mcp/repositories";
import { type CurrentBalanceResult, type MoneyResult } from "./results";

export class CurrentBalanceService {
  constructor(private readonly business: BusinessRepository, private readonly transactions: TransactionRepository) {}

  async getCurrentBalance(): Promise<MoneyResult> {
    const summary = await this.getCurrentBalanceSummary();
    return { currency: summary.currency, amount: summary.currentBalance };
  }

  async getCurrentBalanceSummary(): Promise<CurrentBalanceResult> {
    const [activeBusiness, accounts, transactions] = await Promise.all([
      this.business.getActiveBusiness(), this.business.listAccounts(), this.transactions.list(),
    ]);
    let totalIncome = new Prisma.Decimal(0);
    let totalExpenses = new Prisma.Decimal(0);
    const totalsByAccount = new Map(accounts.map((account) => [account.id, { income: new Prisma.Decimal(0), expenses: new Prisma.Decimal(0) }]));
    for (const transaction of transactions) {
      const totals = totalsByAccount.get(transaction.accountId);
      if (!totals) continue;
      if (transaction.type === "INCOME") { totals.income = totals.income.plus(transaction.amount); totalIncome = totalIncome.plus(transaction.amount); }
      else { totals.expenses = totals.expenses.plus(transaction.amount); totalExpenses = totalExpenses.plus(transaction.amount); }
    }
    let currentBalance = new Prisma.Decimal(0);
    const accountResults = accounts.map((account) => {
      const totals = totalsByAccount.get(account.id)!;
      const balance = account.initialBalance.plus(totals.income).minus(totals.expenses);
      currentBalance = currentBalance.plus(balance);
      return { id: account.id, name: account.name, type: account.type, initialBalance: account.initialBalance.toFixed(2), income: totals.income.toFixed(2), expenses: totals.expenses.toFixed(2), balance: balance.toFixed(2) };
    });
    return { currency: activeBusiness.currency, currentBalance: currentBalance.toFixed(2), totalIncome: totalIncome.toFixed(2), totalExpenses: totalExpenses.toFixed(2), accounts: accountResults };
  }
}
