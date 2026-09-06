import type { FinanceToolDefinition } from "./registry";
import { isExpectedFinanceError, MONEY_PATTERN, type SaleService } from "@/servers/finance-mcp/services";
import type { McpCallToolResult } from "@/shared/mcp";

const id = { type: "integer", minimum: 1 } as const;
const quantity = { type: "integer", minimum: 1 } as const;
const money = { type: "string", pattern: MONEY_PATTERN } as const;
const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const text = { type: "string", minLength: 1 } as const;
const quoteLine = { type: "object", additionalProperties: false, required: ["productId", "quantity"], properties: { productId: id, quantity, unitPrice: money, lineAmount: money }, not: { required: ["unitPrice", "lineAmount"], properties: { unitPrice: money, lineAmount: money } } } as const;
const recordLine = { type: "object", additionalProperties: false, required: ["productId", "quantity", "pricingMode", "catalogUnitPrice", "amount"], properties: { productId: id, quantity, pricingMode: { type: "string", enum: ["CATALOG", "CUSTOM_UNIT", "CUSTOM_LINE"] }, catalogUnitPrice: money, appliedUnitPrice: money, amount: money } } as const;

function response(operation: () => Promise<Record<string, unknown>>, text_: string): Promise<McpCallToolResult> {
  return operation().then((value): McpCallToolResult => ({ content: [{ type: "text", text: text_ }], structuredContent: value })).catch((error): McpCallToolResult => {
    if (!isExpectedFinanceError(error)) throw error;
    return { content: [{ type: "text", text: error.message }], isError: true };
  });
}

export function createSaleTools(service: SaleService): FinanceToolDefinition[] {
  return [
    { name: "quote_sale", description: "Quote a sale using catalog prices or explicit line overrides without writing data.", isWriteOperation: false, inputSchema: { type: "object", additionalProperties: false, required: ["accountId", "categoryId", "date", "lines"], properties: { accountId: id, categoryId: id, date, description: text, lines: { type: "array", minItems: 1, maxItems: 25, items: quoteLine } } }, handler: (args) => response(() => service.quoteSale(args as never), "Sale quoted.") },
    { name: "record_sale", description: "Record a quoted sale atomically as one income and its inventory exits.", isWriteOperation: true, inputSchema: { type: "object", additionalProperties: false, required: ["accountId", "categoryId", "date", "totalAmount", "lines"], properties: { accountId: id, categoryId: id, date, description: text, totalAmount: money, lines: { type: "array", minItems: 1, maxItems: 25, items: recordLine } } }, handler: (args) => response(() => service.recordSale(args as never), "Sale recorded.") },
    { name: "list_sales", description: "List recorded sales and their linked financial and inventory effects.", isWriteOperation: false, inputSchema: { type: "object", additionalProperties: false, properties: { saleId: id, startDate: date, endDate: date } }, handler: (args) => response(async () => ({ currency: "GTQ", sales: await service.listSales(args as never) }), "Sales listed.") },
  ];
}
