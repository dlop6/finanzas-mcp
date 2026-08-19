import { Prisma } from "@/database/generated/prisma/client";
import type { TransactionRepository } from "@/servers/finance-mcp/repositories";
import { CurrentBalanceService } from "./current-balance-service";
import { FinanceDomainError } from "./errors";
import type { CashFlowSummaryResult } from "./results";
import { formatDate, parseDate } from "./validation";

export class CashFlowService {
  constructor(private readonly transactions: TransactionRepository, private readonly balance: CurrentBalanceService) {}
  async getCashFlowSummary(startDateValue: string, endDateValue: string): Promise<CashFlowSummaryResult> {
    const startDate = parseDate(startDateValue, "Start date"); const endDate = parseDate(endDateValue, "End date");
    if (startDate > endDate) throw new FinanceDomainError("Start date must not be after end date.");
    const transactions = await this.transactions.list({ startDate, endDate });
    let income = new Prisma.Decimal(0); let expenses = new Prisma.Decimal(0);
    for (const transaction of transactions) { if (transaction.type === "INCOME") income = income.plus(transaction.amount); else expenses = expenses.plus(transaction.amount); }
    const currentBalance = await this.balance.getCurrentBalance();
    return { currency: currentBalance.currency, startDate: formatDate(startDate), endDate: formatDate(endDate), income: income.toFixed(2), expenses: expenses.toFixed(2), netCashFlow: income.minus(expenses).toFixed(2), transactionCount: transactions.length, currentBalance: currentBalance.amount };
  }
}
