import type { FinanceToolDefinition } from "./registry";
import type { InventoryService } from "@/servers/finance-mcp/services";
import { isExpectedFinanceError, MONEY_PATTERN } from "@/servers/finance-mcp/services";
import type { McpCallToolResult } from "@/shared/mcp";

const id = { type: "integer", minimum: 1 } as const;
const nonNegativeInteger = { type: "integer", minimum: 0 } as const;
const positiveInteger = { type: "integer", minimum: 1 } as const;
const money = { type: "string", pattern: MONEY_PATTERN } as const;
const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const text = { type: "string", minLength: 1 } as const;
async function run<T>(operation: () => Promise<T>, message: string, contents: Record<string, unknown>): Promise<McpCallToolResult> { try { return { content: [{ type: "text", text: message }], structuredContent: { currency: "GTQ", ...contents, value: await operation() } }; } catch (error) { if (!isExpectedFinanceError(error)) throw error; return { content: [{ type: "text", text: error.message }], isError: true }; } }
function result<T>(operation: () => Promise<T>, message: string, key: string): Promise<McpCallToolResult> { return run(operation, message, {}).then((response) => response.isError ? response : { ...response, structuredContent: { currency: "GTQ", [key]: (response.structuredContent as { value: T }).value } }); }

export function createInventoryTools(service: InventoryService): FinanceToolDefinition[] { return [
  { name: "create_product", description: "Create an inventory product.", isWriteOperation: true, inputSchema: { type: "object", additionalProperties: false, required: ["name", "stock", "unitCost", "salePrice", "minimumStock"], properties: { name: text, stock: nonNegativeInteger, unitCost: money, salePrice: money, minimumStock: nonNegativeInteger } }, handler: (a) => result(() => service.createProduct(a as never), "Product created.", "product") },
  { name: "list_products", description: "List inventory products.", isWriteOperation: false, inputSchema: { type: "object", additionalProperties: false, properties: { lowStockOnly: { type: "boolean" } } }, handler: (a) => result(() => service.listProducts(a.lowStockOnly as boolean | undefined), "Products listed.", "products") },
  { name: "update_product", description: "Update an inventory product without changing stock.", isWriteOperation: true, inputSchema: { type: "object", additionalProperties: false, required: ["productId"], anyOf: [{ properties: { name: text }, required: ["name"] }, { properties: { unitCost: money }, required: ["unitCost"] }, { properties: { salePrice: money }, required: ["salePrice"] }, { properties: { minimumStock: nonNegativeInteger }, required: ["minimumStock"] }], properties: { productId: id, name: text, unitCost: money, salePrice: money, minimumStock: nonNegativeInteger } }, handler: (a) => result(() => service.updateProduct(a as never), "Product updated.", "product") },
  { name: "record_inventory_movement", description: "Record an inventory entry or exit.", isWriteOperation: true, inputSchema: { type: "object", additionalProperties: false, required: ["productId", "type", "quantity", "date"], properties: { productId: id, type: { type: "string", enum: ["IN", "OUT"] }, quantity: positiveInteger, date, note: text } }, handler: async (a) => { try { const change = await service.recordInventoryMovement(a as never); return { content: [{ type: "text", text: "Inventory movement recorded." }], structuredContent: { currency: "GTQ", ...change } }; } catch (error) { if (!isExpectedFinanceError(error)) throw error; return { content: [{ type: "text", text: error.message }], isError: true }; } } },
  { name: "list_low_stock_products", description: "List products at or below minimum stock.", isWriteOperation: false, inputSchema: { type: "object", additionalProperties: false, properties: {} }, handler: () => result(() => service.listLowStockProducts(), "Low-stock products listed.", "products") },
]; }
