import type { Transaction, Currency } from "@/database/generated/prisma/client";
import { formatDate, formatMoney } from "./validation";

export type MoneyResult = { currency: "GTQ"; amount: string };
export type TransactionResult = {
  id: number; accountId: number; categoryId: number; type: "INCOME" | "EXPENSE";
  amount: string; date: string; description: string | null;
};

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
