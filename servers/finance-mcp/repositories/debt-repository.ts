import {
  Prisma,
  type Debt,
  type DebtPriority,
  type DebtStatus,
  type PrismaClient,
} from "@/database/generated/prisma/client";

import { getActiveBusiness } from "./active-business";
import { EntityNotFoundError, normalizePersistenceError } from "./errors";

export type CreateDebtInput = {
  description: string;
  amount: Prisma.Decimal;
  dueDate: Date;
  priority: DebtPriority;
  status?: DebtStatus;
};

export type UpdateDebtInput = {
  description?: string;
  amount?: Prisma.Decimal;
  dueDate?: Date;
  priority?: DebtPriority;
};

export type ListDebtsInput = {
  status?: DebtStatus;
  priority?: DebtPriority;
  dueBefore?: Date;
};

export class DebtRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateDebtInput): Promise<Debt> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.prisma.debt.create({ data: { businessId: business.id, ...input } });
    } catch (error) {
      throw normalizePersistenceError(error, "Debt");
    }
  }

  async get(id: number): Promise<Debt> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.requireDebt(business.id, id);
    } catch (error) {
      throw normalizePersistenceError(error, "Debt", id);
    }
  }

  async list(filters: ListDebtsInput = {}): Promise<Debt[]> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.prisma.debt.findMany({
        where: {
          businessId: business.id,
          ...(filters.status === undefined ? {} : { status: filters.status }),
          ...(filters.priority === undefined ? {} : { priority: filters.priority }),
          ...(filters.dueBefore === undefined ? {} : { dueDate: { lte: filters.dueBefore } }),
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      });
    } catch (error) {
      throw normalizePersistenceError(error, "Debt");
    }
  }

  async update(id: number, input: UpdateDebtInput): Promise<Debt> {
    try {
      const business = await getActiveBusiness(this.prisma);
      await this.requireDebt(business.id, id);
      return await this.prisma.debt.update({ where: { id }, data: input });
    } catch (error) {
      throw normalizePersistenceError(error, "Debt", id);
    }
  }

  async updateStatus(id: number, status: DebtStatus): Promise<Debt> {
    try {
      const business = await getActiveBusiness(this.prisma);
      await this.requireDebt(business.id, id);
      return await this.prisma.debt.update({ where: { id }, data: { status } });
    } catch (error) {
      throw normalizePersistenceError(error, "Debt", id);
    }
  }

  async delete(id: number): Promise<Debt> {
    try {
      const business = await getActiveBusiness(this.prisma);
      await this.requireDebt(business.id, id);
      return await this.prisma.debt.delete({ where: { id } });
    } catch (error) {
      throw normalizePersistenceError(error, "Debt", id);
    }
  }

  private async requireDebt(businessId: number, id: number): Promise<Debt> {
    const debt = await this.prisma.debt.findFirst({ where: { id, businessId } });
    if (!debt) throw new EntityNotFoundError("Debt", id);
    return debt;
  }
}
