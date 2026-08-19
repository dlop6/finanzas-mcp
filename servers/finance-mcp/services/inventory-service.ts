import type { InventoryMovementType } from "@/database/generated/prisma/client";
import type { InventoryRepository } from "@/servers/finance-mcp/repositories";
import { FinanceDomainError } from "./errors";
import { inventoryMovementResult, productResult, type InventoryMovementResult, type ProductResult } from "./results";
import { parseDate, parseNonNegativeInteger, parseNonNegativeMoney, parsePositiveInteger, trimDescription } from "./validation";

type CreateInput = { name: string; stock: number; unitCost: string; salePrice: string; minimumStock: number };
type UpdateInput = { productId: number; name?: string; unitCost?: string; salePrice?: string; minimumStock?: number };
type MovementInput = { productId: number; type: InventoryMovementType; quantity: number; date: string; note?: string };
export class InventoryService {
  constructor(private readonly inventory: InventoryRepository) {}
  async createProduct(input: CreateInput): Promise<ProductResult> { return productResult(await this.inventory.createProduct({ name: trimDescription(input.name, true)!, stock: parseNonNegativeInteger(input.stock, "Stock"), unitCost: parseNonNegativeMoney(input.unitCost), salePrice: parseNonNegativeMoney(input.salePrice), minimumStock: parseNonNegativeInteger(input.minimumStock, "Minimum stock") })); }
  async listProducts(lowStockOnly = false): Promise<ProductResult[]> { return (await this.inventory.listProducts(lowStockOnly)).map(productResult); }
  async listLowStockProducts(): Promise<ProductResult[]> { return this.listProducts(true); }
  async updateProduct(input: UpdateInput): Promise<ProductResult> { const update: { name?: string; unitCost?: ReturnType<typeof parseNonNegativeMoney>; salePrice?: ReturnType<typeof parseNonNegativeMoney>; minimumStock?: number } = {}; if (input.name !== undefined) update.name = trimDescription(input.name, true); if (input.unitCost !== undefined) update.unitCost = parseNonNegativeMoney(input.unitCost); if (input.salePrice !== undefined) update.salePrice = parseNonNegativeMoney(input.salePrice); if (input.minimumStock !== undefined) update.minimumStock = parseNonNegativeInteger(input.minimumStock, "Minimum stock"); if (Object.keys(update).length === 0) throw new FinanceDomainError("At least one field must be provided for update."); return productResult(await this.inventory.updateProduct(input.productId, update)); }
  async recordInventoryMovement(input: MovementInput): Promise<{ product: ProductResult; movement: InventoryMovementResult }> { const change = await this.inventory.recordMovement({ productId: input.productId, type: input.type, quantity: parsePositiveInteger(input.quantity, "Quantity"), date: parseDate(input.date), ...(input.note === undefined ? {} : { note: trimDescription(input.note) }) }); return { product: productResult(change.product), movement: inventoryMovementResult(change.movement) }; }
}
