import type { TransactionType } from "@/database/generated/prisma/client";
import type { BusinessRepository, TransactionRepository } from "@/servers/finance-mcp/repositories";
import { CurrentBalanceService } from "./current-balance-service";
import { FinanceDomainError } from "./errors";
import { transactionResult, type MoneyResult, type TransactionResult } from "./results";
import { parseDate, parseMoney, trimDescription } from "./validation";

type RecordTransactionInput = { accountId: number; categoryId: number; amount: string; date: string; description?: string };
type ListInput = { startDate?: string; endDate?: string; type?: TransactionType; categoryId?: number; accountId?: number };
type UpdateInput = { transactionId: number; accountId?: number; categoryId?: number; amount?: string; date?: string; description?: string };
export type TransactionMutationResult = { transaction: TransactionResult; currentBalance: MoneyResult };

export class TransactionService {
  constructor(
    private readonly business: BusinessRepository,
    private readonly transactions: TransactionRepository,
    private readonly balance: CurrentBalanceService,
  ) {}

  recordIncome(input: RecordTransactionInput): Promise<TransactionMutationResult> { return this.record(input, "INCOME"); }
  recordExpense(input: RecordTransactionInput): Promise<TransactionMutationResult> { return this.record(input, "EXPENSE"); }

  async listTransactions(input: ListInput): Promise<TransactionResult[]> {
    const startDate = input.startDate === undefined ? undefined : parseDate(input.startDate, "Start date");
    const endDate = input.endDate === undefined ? undefined : parseDate(input.endDate, "End date");
    if (startDate && endDate && startDate > endDate) throw new FinanceDomainError("Start date must not be after end date.");
    if (input.accountId !== undefined) await this.business.getAccount(input.accountId);
    if (input.categoryId !== undefined) await this.business.getCategory(input.categoryId);
    return (await this.transactions.list({ ...input, startDate, endDate })).map(transactionResult);
  }

  async updateTransaction(input: UpdateInput): Promise<TransactionMutationResult> {
    const existing = await this.transactions.get(input.transactionId);
    const update: { accountId?: number; categoryId?: number; amount?: ReturnType<typeof parseMoney>; date?: Date; description?: string } = {};
    if (input.accountId !== undefined) { await this.business.getAccount(input.accountId); update.accountId = input.accountId; }
    if (input.categoryId !== undefined) {
      const category = await this.business.getCategory(input.categoryId);
      if (category.type !== existing.type) throw new FinanceDomainError("Category type must match the transaction type.");
      update.categoryId = input.categoryId;
    }
    if (input.amount !== undefined) update.amount = parseMoney(input.amount);
    if (input.date !== undefined) update.date = parseDate(input.date);
    if (input.description !== undefined) update.description = trimDescription(input.description);
    if (Object.keys(update).length === 0) throw new FinanceDomainError("At least one field must be provided for update.");
    const transaction = await this.transactions.update(input.transactionId, update);
    return { transaction: transactionResult(transaction), currentBalance: await this.balance.getCurrentBalance() };
  }

  async deleteTransaction(transactionId: number): Promise<TransactionMutationResult> {
    const transaction = await this.transactions.delete(transactionId);
    return { transaction: transactionResult(transaction), currentBalance: await this.balance.getCurrentBalance() };
  }

  private async record(input: RecordTransactionInput, type: TransactionType): Promise<TransactionMutationResult> {
    const category = await this.business.getCategory(input.categoryId);
    if (category.type !== type) throw new FinanceDomainError("Category type must match the transaction type.");
    await this.business.getAccount(input.accountId);
    const transaction = await this.transactions.create({
      accountId: input.accountId, categoryId: input.categoryId, type, amount: parseMoney(input.amount),
      date: parseDate(input.date), ...(input.description === undefined ? {} : { description: trimDescription(input.description) }),
    });
    return { transaction: transactionResult(transaction), currentBalance: await this.balance.getCurrentBalance() };
  }
}
