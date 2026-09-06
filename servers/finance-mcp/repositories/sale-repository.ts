import { Prisma, type PrismaClient, type SalePricingMode, type TransactionType } from "@/database/generated/prisma/client";
import { getActiveBusiness } from "./active-business";
import { EntityNotFoundError, InventoryIntegrityError, SaleValidationError, normalizePersistenceError } from "./errors";

export type SaleLineInput = { productId: number; quantity: number; pricingMode: SalePricingMode; catalogUnitPrice: Prisma.Decimal; appliedUnitPrice?: Prisma.Decimal; amount: Prisma.Decimal };
export type CreateSaleInput = { accountId: number; categoryId: number; date: Date; description?: string; totalAmount: Prisma.Decimal; lines: readonly SaleLineInput[] };

/** Owns the sole database transaction that links a sale, its income, and its inventory exits. */
export class SaleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async quote(input: Omit<CreateSaleInput, "totalAmount"> & { totalAmount: Prisma.Decimal }) {
    try {
      const business = await getActiveBusiness(this.prisma);
      const [account, category] = await Promise.all([
        this.prisma.account.findFirst({ where: { id: input.accountId, businessId: business.id } }),
        this.prisma.category.findFirst({ where: { id: input.categoryId, businessId: business.id } }),
      ]);
      if (!account) throw new EntityNotFoundError("Account", input.accountId);
      if (!category) throw new EntityNotFoundError("Category", input.categoryId);
      if (category.type !== "INCOME") throw new SaleValidationError("The sale category must be an income category.");
      const products = await this.prisma.product.findMany({ where: { businessId: business.id, id: { in: input.lines.map((line) => line.productId) } } });
      if (products.length !== new Set(input.lines.map((line) => line.productId)).size) throw new EntityNotFoundError("Product", 0);
      return { account, category, products };
    } catch (error) { throw normalizePersistenceError(error, "Sale"); }
  }

  async create(input: CreateSaleInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const business = await getActiveBusiness(tx);
        const [account, category] = await Promise.all([
          tx.account.findFirst({ where: { id: input.accountId, businessId: business.id } }),
          tx.category.findFirst({ where: { id: input.categoryId, businessId: business.id } }),
        ]);
        if (!account) throw new EntityNotFoundError("Account", input.accountId);
        if (!category) throw new EntityNotFoundError("Category", input.categoryId);
        if (category.type !== "INCOME") throw new SaleValidationError("The sale category must be an income category.");
        const products = await tx.product.findMany({ where: { businessId: business.id, id: { in: input.lines.map((line) => line.productId) } } });
        const productById = new Map(products.map((product) => [product.id, product]));
        const quantities = new Map<number, number>();
        for (const line of input.lines) quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
        for (const [productId, quantity] of quantities) {
          const product = productById.get(productId);
          if (!product) throw new EntityNotFoundError("Product", productId);
          const updated = await tx.product.updateMany({ where: { id: productId, businessId: business.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
          if (updated.count !== 1) throw new InventoryIntegrityError();
        }
        const transaction = await tx.transaction.create({ data: { businessId: business.id, accountId: input.accountId, categoryId: input.categoryId, type: "INCOME" satisfies TransactionType, amount: input.totalAmount, date: input.date, ...(input.description === undefined ? {} : { description: input.description }) } });
        const sale = await tx.sale.create({ data: { businessId: business.id, transactionId: transaction.id } });
        const lines = [] as Array<{ input: SaleLineInput; productName: string; movementId: number }>;
        for (const line of input.lines) {
          const product = productById.get(line.productId)!;
          if (!product.salePrice.equals(line.catalogUnitPrice)) throw new SaleValidationError("The catalog price changed. Quote the sale again before confirming.");
          const movement = await tx.inventoryMovement.create({ data: { businessId: business.id, productId: line.productId, type: "OUT", quantity: line.quantity, date: input.date, ...(input.description === undefined ? {} : { note: input.description }) } });
          await tx.saleLine.create({ data: { saleId: sale.id, inventoryMovementId: movement.id, pricingMode: line.pricingMode, catalogUnitPrice: line.catalogUnitPrice, ...(line.appliedUnitPrice === undefined ? {} : { appliedUnitPrice: line.appliedUnitPrice }), amount: line.amount } });
          lines.push({ input: line, productName: product.name, movementId: movement.id });
        }
        return { sale, transaction, account, category, lines };
      });
    } catch (error) { throw normalizePersistenceError(error, "Sale"); }
  }

  async list(filters: { saleId?: number; startDate?: Date; endDate?: Date }) {
    try {
      const business = await getActiveBusiness(this.prisma);
      return await this.prisma.sale.findMany({
        where: { businessId: business.id, ...(filters.saleId === undefined ? {} : { id: filters.saleId }), ...(filters.startDate || filters.endDate ? { transaction: { date: { ...(filters.startDate ? { gte: filters.startDate } : {}), ...(filters.endDate ? { lte: filters.endDate } : {}) } } } : {}) },
        include: { transaction: { include: { account: true, category: true } }, lines: { include: { inventoryMovement: { include: { product: true } } }, orderBy: { id: "asc" } } },
        orderBy: [{ transaction: { date: "desc" } }, { id: "desc" }],
      });
    } catch (error) { throw normalizePersistenceError(error, "Sale"); }
  }
}
