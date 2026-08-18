import type {
  Account,
  Business,
  Category,
  FixedExpense,
  PrismaClient,
  TransactionType,
} from "@/database/generated/prisma/client";

import { getActiveBusiness } from "./active-business";
import { EntityNotFoundError, normalizePersistenceError } from "./errors";

export class BusinessRepository {
  constructor(private readonly prisma: PrismaClient) {}

  getActiveBusiness(): Promise<Business> {
    return getActiveBusiness(this.prisma);
  }

  async listAccounts(): Promise<Account[]> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.prisma.account.findMany({
        where: { businessId: business.id },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
    } catch (error) {
      throw normalizePersistenceError(error, "Account");
    }
  }

  async getAccount(id: number): Promise<Account> {
    try {
      const business = await getActiveBusiness(this.prisma);
      const account = await this.prisma.account.findFirst({ where: { id, businessId: business.id } });
      if (!account) {
        throw new EntityNotFoundError("Account", id);
      }
      return account;
    } catch (error) {
      throw normalizePersistenceError(error, "Account", id);
    }
  }

  async listCategories(type?: TransactionType): Promise<Category[]> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.prisma.category.findMany({
        where: { businessId: business.id, ...(type === undefined ? {} : { type }) },
        orderBy: [{ type: "asc" }, { name: "asc" }, { id: "asc" }],
      });
    } catch (error) {
      throw normalizePersistenceError(error, "Category");
    }
  }

  async getCategory(id: number): Promise<Category> {
    try {
      const business = await getActiveBusiness(this.prisma);
      const category = await this.prisma.category.findFirst({ where: { id, businessId: business.id } });
      if (!category) {
        throw new EntityNotFoundError("Category", id);
      }
      return category;
    } catch (error) {
      throw normalizePersistenceError(error, "Category", id);
    }
  }

  async listFixedExpenses(active?: boolean): Promise<FixedExpense[]> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.prisma.fixedExpense.findMany({
        where: { businessId: business.id, ...(active === undefined ? {} : { active }) },
        orderBy: [{ dueDay: "asc" }, { name: "asc" }, { id: "asc" }],
      });
    } catch (error) {
      throw normalizePersistenceError(error, "FixedExpense");
    }
  }
}
