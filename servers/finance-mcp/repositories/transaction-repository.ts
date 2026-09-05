import { Prisma, type PrismaClient, type Transaction, type TransactionType } from "@/database/generated/prisma/client";

import { getActiveBusiness } from "./active-business";
import { EntityNotFoundError, normalizePersistenceError } from "./errors";

export type CreateTransactionInput = {
  accountId: number;
  categoryId: number;
  type: TransactionType;
  amount: Prisma.Decimal;
  date: Date;
  description?: string | null;
};

export type UpdateTransactionInput = {
  accountId?: number;
  categoryId?: number;
  amount?: Prisma.Decimal;
  date?: Date;
  description?: string | null;
};

export type ListTransactionsInput = {
  startDate?: Date;
  endDate?: Date;
  type?: TransactionType;
  categoryId?: number;
  accountId?: number;
};

export class TransactionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateTransactionInput): Promise<Transaction> {
    try {
      const business = await getActiveBusiness(this.prisma);
      await Promise.all([this.requireAccount(business.id, input.accountId), this.requireCategory(business.id, input.categoryId)]);
      return await this.prisma.transaction.create({ data: { businessId: business.id, ...input } });
    } catch (error) {
      throw normalizePersistenceError(error, "Transaction");
    }
  }

  /** Creates a homogeneous batch as one database unit so a rejected row never leaves partial financial data. */
  async createBatch(inputs: readonly CreateTransactionInput[]): Promise<Transaction[]> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const business = await getActiveBusiness(tx);
        const created: Transaction[] = [];
        for (const input of inputs) {
          await Promise.all([this.requireAccount(business.id, input.accountId, tx), this.requireCategory(business.id, input.categoryId, tx)]);
          created.push(await tx.transaction.create({ data: { businessId: business.id, ...input } }));
        }
        return created;
      });
    } catch (error) {
      throw normalizePersistenceError(error, "Transaction");
    }
  }

  async get(id: number): Promise<Transaction> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.requireTransaction(business.id, id);
    } catch (error) {
      throw normalizePersistenceError(error, "Transaction", id);
    }
  }

  async list(filters: ListTransactionsInput = {}): Promise<Transaction[]> {
    try {
      const business = await getActiveBusiness(this.prisma);
      const date = filters.startDate || filters.endDate
        ? { ...(filters.startDate ? { gte: filters.startDate } : {}), ...(filters.endDate ? { lte: filters.endDate } : {}) }
        : undefined;
      return await this.prisma.transaction.findMany({
        where: {
          businessId: business.id,
          ...(filters.type === undefined ? {} : { type: filters.type }),
          ...(filters.categoryId === undefined ? {} : { categoryId: filters.categoryId }),
          ...(filters.accountId === undefined ? {} : { accountId: filters.accountId }),
          ...(date === undefined ? {} : { date }),
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
      });
    } catch (error) {
      throw normalizePersistenceError(error, "Transaction");
    }
  }

  async update(id: number, input: UpdateTransactionInput): Promise<Transaction> {
    try {
      const business = await getActiveBusiness(this.prisma);
      await this.requireTransaction(business.id, id);
      if (input.accountId !== undefined) await this.requireAccount(business.id, input.accountId);
      if (input.categoryId !== undefined) await this.requireCategory(business.id, input.categoryId);
      return await this.prisma.transaction.update({ where: { id }, data: input });
    } catch (error) {
      throw normalizePersistenceError(error, "Transaction", id);
    }
  }

  async delete(id: number): Promise<Transaction> {
    try {
      const business = await getActiveBusiness(this.prisma);
      await this.requireTransaction(business.id, id);
      return await this.prisma.transaction.delete({ where: { id } });
    } catch (error) {
      throw normalizePersistenceError(error, "Transaction", id);
    }
  }

  private async requireTransaction(businessId: number, id: number): Promise<Transaction> {
    const transaction = await this.prisma.transaction.findFirst({ where: { id, businessId } });
    if (!transaction) throw new EntityNotFoundError("Transaction", id);
    return transaction;
  }

  private async requireAccount(businessId: number, id: number, prisma: Pick<PrismaClient, "account"> = this.prisma): Promise<void> {
    const account = await prisma.account.findFirst({ where: { id, businessId } });
    if (!account) throw new EntityNotFoundError("Account", id);
  }

  private async requireCategory(businessId: number, id: number, prisma: Pick<PrismaClient, "category"> = this.prisma): Promise<void> {
    const category = await prisma.category.findFirst({ where: { id, businessId } });
    if (!category) throw new EntityNotFoundError("Category", id);
  }
}
