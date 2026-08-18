import type { Transaction, Currency, Debt, Receivable } from "@/database/generated/prisma/client";
import { formatDate, formatMoney } from "./validation";

export type MoneyResult = { currency: "GTQ"; amount: string };
export type TransactionResult = {
  id: number; accountId: number; categoryId: number; type: "INCOME" | "EXPENSE";
  amount: string; date: string; description: string | null;
};
export type DebtResult = { id: number; description: string; amount: string; dueDate: string; priority: "LOW" | "MEDIUM" | "HIGH"; status: "PENDING" | "PAID" };
export type ReceivableResult = { id: number; description: string; amount: string; expectedDate: string; confidence: "CONFIRMED" | "UNCONFIRMED"; status: "PENDING" | "COLLECTED" };

export function moneyResult(amount: { toFixed: (digits: number) => string }, currency: Currency): MoneyResult {
  return { currency: currency as "GTQ", amount: amount.toFixed(2) };
}

export function transactionResult(transaction: Transaction): TransactionResult {
  return {
    id: transaction.id, accountId: transaction.accountId, categoryId: transaction.categoryId,
    type: transaction.type, amount: formatMoney(transaction.amount), date: formatDate(transaction.date),
    description: transaction.description,
  };
}
export function debtResult(debt: Debt): DebtResult {
  return { id: debt.id, description: debt.description, amount: formatMoney(debt.amount), dueDate: formatDate(debt.dueDate), priority: debt.priority, status: debt.status };
}
export function receivableResult(receivable: Receivable): ReceivableResult {
  return { id: receivable.id, description: receivable.description, amount: formatMoney(receivable.amount), expectedDate: formatDate(receivable.expectedDate), confidence: receivable.confidence, status: receivable.status };
}
