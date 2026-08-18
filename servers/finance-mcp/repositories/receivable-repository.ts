import {
  Prisma,
  type PrismaClient,
  type Receivable,
  type ReceivableConfidence,
  type ReceivableStatus,
} from "@/database/generated/prisma/client";

import { getActiveBusiness } from "./active-business";
import { EntityNotFoundError, normalizePersistenceError } from "./errors";

export type CreateReceivableInput = {
  description: string;
  amount: Prisma.Decimal;
  expectedDate: Date;
  confidence: ReceivableConfidence;
  status?: ReceivableStatus;
};

export type UpdateReceivableInput = {
  description?: string;
  amount?: Prisma.Decimal;
  expectedDate?: Date;
  confidence?: ReceivableConfidence;
};

export type ListReceivablesInput = {
  status?: ReceivableStatus;
  confidence?: ReceivableConfidence;
  dueBefore?: Date;
};

export class ReceivableRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateReceivableInput): Promise<Receivable> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.prisma.receivable.create({ data: { businessId: business.id, ...input } });
    } catch (error) {
      throw normalizePersistenceError(error, "Receivable");
    }
  }

  async get(id: number): Promise<Receivable> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.requireReceivable(business.id, id);
    } catch (error) {
      throw normalizePersistenceError(error, "Receivable", id);
    }
  }

  async list(filters: ListReceivablesInput = {}): Promise<Receivable[]> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.prisma.receivable.findMany({
        where: {
          businessId: business.id,
          ...(filters.status === undefined ? {} : { status: filters.status }),
          ...(filters.confidence === undefined ? {} : { confidence: filters.confidence }),
          ...(filters.dueBefore === undefined ? {} : { expectedDate: { lte: filters.dueBefore } }),
        },
        orderBy: [{ expectedDate: "asc" }, { id: "asc" }],
      });
    } catch (error) {
      throw normalizePersistenceError(error, "Receivable");
    }
  }

  async update(id: number, input: UpdateReceivableInput): Promise<Receivable> {
    try {
      const business = await getActiveBusiness(this.prisma);
      await this.requireReceivable(business.id, id);
      return await this.prisma.receivable.update({ where: { id }, data: input });
    } catch (error) {
      throw normalizePersistenceError(error, "Receivable", id);
    }
  }

  async updateStatus(id: number, status: ReceivableStatus): Promise<Receivable> {
    try {
      const business = await getActiveBusiness(this.prisma);
      await this.requireReceivable(business.id, id);
      return await this.prisma.receivable.update({ where: { id }, data: { status } });
    } catch (error) {
      throw normalizePersistenceError(error, "Receivable", id);
    }
  }

  async delete(id: number): Promise<Receivable> {
    try {
      const business = await getActiveBusiness(this.prisma);
      await this.requireReceivable(business.id, id);
      return await this.prisma.receivable.delete({ where: { id } });
    } catch (error) {
      throw normalizePersistenceError(error, "Receivable", id);
    }
  }

  private async requireReceivable(businessId: number, id: number): Promise<Receivable> {
    const receivable = await this.prisma.receivable.findFirst({ where: { id, businessId } });
    if (!receivable) throw new EntityNotFoundError("Receivable", id);
    return receivable;
  }
}
