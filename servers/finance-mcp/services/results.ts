import type { Transaction, Currency, Debt, Receivable, Product, InventoryMovement } from "@/database/generated/prisma/client";
import { formatDate, formatMoney } from "./validation";

export type MoneyResult = { currency: "GTQ"; amount: string };
export type TransactionResult = {
  id: number; accountId: number; categoryId: number; type: "INCOME" | "EXPENSE";
  amount: string; date: string; description: string | null;
};
export type DebtResult = { id: number; description: string; amount: string; dueDate: string; priority: "LOW" | "MEDIUM" | "HIGH"; status: "PENDING" | "PAID" };
export type ReceivableResult = { id: number; description: string; amount: string; expectedDate: string; confidence: "CONFIRMED" | "UNCONFIRMED"; status: "PENDING" | "COLLECTED" };
export type ProductResult = { id: number; name: string; stock: number; unitCost: string; salePrice: string; minimumStock: number };
export type InventoryMovementResult = { id: number; productId: number; type: "IN" | "OUT"; quantity: number; date: string; note: string | null };
export type AccountBalanceResult = { id: number; name: string; type: "CASH" | "BANK"; initialBalance: string; income: string; expenses: string; balance: string };
export type CurrentBalanceResult = { currency: "GTQ"; currentBalance: string; totalIncome: string; totalExpenses: string; accounts: AccountBalanceResult[] };
export type CashFlowSummaryResult = { currency: "GTQ"; startDate: string; endDate: string; income: string; expenses: string; netCashFlow: string; transactionCount: number; currentBalance: string };

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
export function productResult(product: Product): ProductResult { return { id: product.id, name: product.name, stock: product.stock, unitCost: formatMoney(product.unitCost), salePrice: formatMoney(product.salePrice), minimumStock: product.minimumStock }; }
export function inventoryMovementResult(movement: InventoryMovement): InventoryMovementResult { return { id: movement.id, productId: movement.productId, type: movement.type, quantity: movement.quantity, date: formatDate(movement.date), note: movement.note }; }
