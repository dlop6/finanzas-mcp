import {
  Prisma,
  type InventoryMovement,
  type InventoryMovementType,
  type PrismaClient,
  type Product,
} from "@/database/generated/prisma/client";

import { getActiveBusiness } from "./active-business";
import { EntityNotFoundError, InventoryIntegrityError, normalizePersistenceError } from "./errors";

export type CreateProductInput = {
  name: string;
  stock: number;
  unitCost: Prisma.Decimal;
  salePrice: Prisma.Decimal;
  minimumStock: number;
};

export type UpdateProductInput = {
  name?: string;
  unitCost?: Prisma.Decimal;
  salePrice?: Prisma.Decimal;
  minimumStock?: number;
};

export type ListInventoryMovementsInput = {
  productId?: number;
  startDate?: Date;
  endDate?: Date;
};

export type RecordInventoryMovementInput = {
  productId: number;
  type: InventoryMovementType;
  quantity: number;
  date: Date;
  note?: string | null;
};

export type InventoryMovementChange = {
  product: Product;
  movement: InventoryMovement;
};

export class InventoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createProduct(input: CreateProductInput): Promise<Product> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.prisma.product.create({ data: { businessId: business.id, ...input } });
    } catch (error) {
      throw normalizePersistenceError(error, "Product");
    }
  }

  async getProduct(id: number): Promise<Product> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.requireProduct(this.prisma, business.id, id);
    } catch (error) {
      throw normalizePersistenceError(error, "Product", id);
    }
  }

  async listProducts(lowStockOnly = false): Promise<Product[]> {
    try {
      const business = await getActiveBusiness(this.prisma);
      const products = await this.prisma.product.findMany({
        where: { businessId: business.id },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return lowStockOnly ? products.filter((product) => product.stock <= product.minimumStock) : products;
    } catch (error) {
      throw normalizePersistenceError(error, "Product");
    }
  }

  async updateProduct(id: number, input: UpdateProductInput): Promise<Product> {
    try {
      const business = await getActiveBusiness(this.prisma);
      await this.requireProduct(this.prisma, business.id, id);
      return await this.prisma.product.update({ where: { id }, data: input });
    } catch (error) {
      throw normalizePersistenceError(error, "Product", id);
    }
  }

  async getMovement(id: number): Promise<InventoryMovement> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.requireMovement(this.prisma, business.id, id);
    } catch (error) {
      throw normalizePersistenceError(error, "InventoryMovement", id);
    }
  }

  async listMovements(filters: ListInventoryMovementsInput = {}): Promise<InventoryMovement[]> {
    try {
      const business = await getActiveBusiness(this.prisma);
      if (filters.productId !== undefined) {
        await this.requireProduct(this.prisma, business.id, filters.productId);
      }
      const date = filters.startDate || filters.endDate
        ? { ...(filters.startDate ? { gte: filters.startDate } : {}), ...(filters.endDate ? { lte: filters.endDate } : {}) }
        : undefined;
      return await this.prisma.inventoryMovement.findMany({
        where: {
          businessId: business.id,
          ...(filters.productId === undefined ? {} : { productId: filters.productId }),
          ...(date === undefined ? {} : { date }),
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
      });
    } catch (error) {
      throw normalizePersistenceError(error, "InventoryMovement");
    }
  }

  async recordMovement(input: RecordInventoryMovementInput): Promise<InventoryMovementChange> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.prisma.$transaction(async (tx) => {
        const product = await this.requireProduct(tx, business.id, input.productId);
        const delta = input.type === "IN" ? input.quantity : -input.quantity;
        if (product.stock + delta < 0) {
          throw new InventoryIntegrityError();
        }

        const updatedProduct = await tx.product.update({
          where: { id: product.id },
          data: { stock: { increment: delta } },
        });
        const movement = await tx.inventoryMovement.create({
          data: { businessId: business.id, ...input },
        });
        return { product: updatedProduct, movement };
      });
    } catch (error) {
      throw normalizePersistenceError(error, "InventoryMovement");
    }
  }

  async deleteMovement(id: number): Promise<InventoryMovementChange> {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.prisma.$transaction(async (tx) => {
        const movement = await this.requireMovement(tx, business.id, id);
        const product = await this.requireProduct(tx, business.id, movement.productId);
        const delta = movement.type === "IN" ? -movement.quantity : movement.quantity;
        if (product.stock + delta < 0) {
          throw new InventoryIntegrityError();
        }

        const updatedProduct = await tx.product.update({
          where: { id: product.id },
          data: { stock: { increment: delta } },
        });
        const deletedMovement = await tx.inventoryMovement.delete({ where: { id: movement.id } });
        return { product: updatedProduct, movement: deletedMovement };
      });
    } catch (error) {
      throw normalizePersistenceError(error, "InventoryMovement", id);
    }
  }

  private async requireProduct(
    client: Pick<PrismaClient, "product">,
    businessId: number,
    id: number,
  ): Promise<Product> {
    const product = await client.product.findFirst({ where: { id, businessId } });
    if (!product) throw new EntityNotFoundError("Product", id);
    return product;
  }

  private async requireMovement(
    client: Pick<PrismaClient, "inventoryMovement">,
    businessId: number,
    id: number,
  ): Promise<InventoryMovement> {
    const movement = await client.inventoryMovement.findFirst({ where: { id, businessId } });
    if (!movement) throw new EntityNotFoundError("InventoryMovement", id);
    return movement;
  }
}
