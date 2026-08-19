import { Prisma, type FixedExpense } from "@/database/generated/prisma/client";
import type { BusinessRepository, DebtRepository, ReceivableRepository } from "@/servers/finance-mcp/repositories";
import { CurrentBalanceService } from "./current-balance-service";
import { debtResult, receivableResult, type CashFlowProjectionResult } from "./results";
import { formatDate } from "./validation";

export type FinanceClock = { todayUtc(): Date };
export const systemFinanceClock: FinanceClock = { todayUtc: () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) };

function addDays(date: Date, days: number): Date { const value = new Date(date); value.setUTCDate(value.getUTCDate() + days); return value; }
function compareDate(left: Date, right: Date): number { return left.getTime() - right.getTime(); }
function fixedExpenseDueDate(expense: FixedExpense, asOfDate: Date): Date {
  const candidate = (year: number, month: number) => new Date(Date.UTC(year, month, Math.min(expense.dueDay, new Date(Date.UTC(year, month + 1, 0)).getUTCDate())));
  const current = candidate(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth());
  return current > asOfDate ? current : candidate(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth() + 1);
}

export class ProjectionService {
  constructor(private readonly business: BusinessRepository, private readonly debts: DebtRepository, private readonly receivables: ReceivableRepository, private readonly balance: CurrentBalanceService, private readonly clock: FinanceClock = systemFinanceClock) {}
  async projectCashFlow(horizonDays: 7 | 30): Promise<CashFlowProjectionResult> {
    const asOfDate = this.clock.todayUtc(); const throughDate = addDays(asOfDate, horizonDays);
    const [currentBalance, pendingDebts, pendingReceivables, fixedExpenses] = await Promise.all([
      this.balance.getCurrentBalance(), this.debts.list({ status: "PENDING", dueBefore: throughDate }), this.receivables.list({ status: "PENDING", dueBefore: throughDate }), this.business.listFixedExpenses(true),
    ]);
    const within = (date: Date) => compareDate(date, asOfDate) > 0 && compareDate(date, throughDate) <= 0;
    const confirmed = pendingReceivables.filter((item) => item.confidence === "CONFIRMED" && within(item.expectedDate));
    const unconfirmed = pendingReceivables.filter((item) => item.confidence === "UNCONFIRMED" && within(item.expectedDate));
    const debts = pendingDebts.filter((item) => within(item.dueDate));
    const expenses = fixedExpenses.map((expense) => ({ expense, dueDate: fixedExpenseDueDate(expense, asOfDate) })).filter(({ dueDate }) => within(dueDate));
    const sum = (values: Array<{ amount: Prisma.Decimal }>) => values.reduce((total, value) => total.plus(value.amount), new Prisma.Decimal(0));
    const confirmedTotal = sum(confirmed); const unconfirmedTotal = sum(unconfirmed); const debtTotal = sum(debts); const expenseTotal = sum(expenses.map(({ expense }) => expense)); const current = new Prisma.Decimal(currentBalance.amount);
    const safe = current.plus(confirmedTotal).minus(expenseTotal).minus(debtTotal); const potential = safe.plus(unconfirmedTotal);
    return { currency: currentBalance.currency, asOfDate: formatDate(asOfDate), throughDate: formatDate(throughDate), horizonDays, currentBalance: current.toFixed(2), confirmedReceivables: confirmedTotal.toFixed(2), unconfirmedReceivables: unconfirmedTotal.toFixed(2), fixedExpenses: expenseTotal.toFixed(2), pendingDebts: debtTotal.toFixed(2), safeProjectedBalance: safe.toFixed(2), potentialProjectedBalance: potential.toFixed(2), details: { confirmedReceivables: confirmed.map(receivableResult), unconfirmedReceivables: unconfirmed.map(receivableResult), fixedExpenses: expenses.map(({ expense, dueDate }) => ({ id: expense.id, categoryId: expense.categoryId, name: expense.name, amount: expense.amount.toFixed(2), dueDay: expense.dueDay, dueDate: formatDate(dueDate) })), pendingDebts: debts.map(debtResult) } };
  }
}
