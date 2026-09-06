import { Prisma, type SalePricingMode } from "@/database/generated/prisma/client";
import type { SaleRepository } from "@/servers/finance-mcp/repositories";
import { FinanceDomainError } from "./errors";
import { formatDate, formatMoney, parseDate, parseMoney, parsePositiveInteger, trimDescription } from "./validation";

type QuoteLine = { productId: number; quantity: number; unitPrice?: string; lineAmount?: string };
type QuoteInput = { accountId: number; categoryId: number; date: string; description?: string; lines: QuoteLine[] };
type RecordLine = { productId: number; quantity: number; pricingMode: SalePricingMode; catalogUnitPrice: string; appliedUnitPrice?: string; amount: string };
type RecordInput = { accountId: number; categoryId: number; date: string; description?: string; totalAmount: string; lines: RecordLine[] };

function limit(lines: readonly unknown[]): void { if (lines.length < 1 || lines.length > 25) throw new FinanceDomainError("A sale must contain between 1 and 25 lines."); }
function isMode(value: string): value is SalePricingMode { return value === "CATALOG" || value === "CUSTOM_UNIT" || value === "CUSTOM_LINE"; }

export class SaleService {
  constructor(private readonly sales: SaleRepository) {}

  async quoteSale(input: QuoteInput) {
    limit(input.lines);
    const date = parseDate(input.date);
    const description = input.description === undefined ? undefined : trimDescription(input.description);
    const raw = input.lines.map((line) => ({ ...line, quantity: parsePositiveInteger(line.quantity, "Quantity") }));
    const productsInfo = await this.sales.quote({ accountId: input.accountId, categoryId: input.categoryId, date, description, totalAmount: new Prisma.Decimal(0), lines: raw.map((line) => ({ productId: line.productId, quantity: line.quantity, pricingMode: "CATALOG", catalogUnitPrice: new Prisma.Decimal(0), amount: new Prisma.Decimal(0) })) });
    const products = new Map(productsInfo.products.map((product) => [product.id, product]));
    const quantities = new Map<number, number>();
    for (const line of raw) quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
    for (const [productId, quantity] of quantities) if ((products.get(productId)?.stock ?? -1) < quantity) throw new FinanceDomainError("Insufficient stock for this sale.");
    const lines = raw.map((line) => {
      if (line.unitPrice !== undefined && line.lineAmount !== undefined) throw new FinanceDomainError("A sale line cannot include both unitPrice and lineAmount.");
      const product = products.get(line.productId); if (!product) throw new FinanceDomainError("Product is not available.");
      const catalogUnitPrice = product.salePrice;
      const pricingMode: SalePricingMode = line.unitPrice === undefined ? line.lineAmount === undefined ? "CATALOG" : "CUSTOM_LINE" : "CUSTOM_UNIT";
      const appliedUnitPrice = line.unitPrice === undefined ? undefined : parseMoney(line.unitPrice);
      const amount = line.lineAmount === undefined ? (appliedUnitPrice ?? catalogUnitPrice).mul(line.quantity) : parseMoney(line.lineAmount);
      if (!amount.greaterThan(0)) throw new FinanceDomainError("Sale line amount must be greater than zero.");
      return { product, productId: line.productId, quantity: line.quantity, pricingMode, catalogUnitPrice, ...(appliedUnitPrice === undefined ? {} : { appliedUnitPrice }), amount };
    });
    const totalAmount = lines.reduce((total, line) => total.add(line.amount), new Prisma.Decimal(0));
    const recordArguments = { accountId: input.accountId, categoryId: input.categoryId, date: formatDate(date), ...(description === undefined ? {} : { description }), totalAmount: formatMoney(totalAmount), lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity, pricingMode: line.pricingMode, catalogUnitPrice: formatMoney(line.catalogUnitPrice), ...(line.appliedUnitPrice === undefined ? {} : { appliedUnitPrice: formatMoney(line.appliedUnitPrice) }), amount: formatMoney(line.amount) })) };
    return { currency: "GTQ" as const, account: { id: productsInfo.account.id, name: productsInfo.account.name }, category: { id: productsInfo.category.id, name: productsInfo.category.name }, date: formatDate(date), ...(description === undefined ? {} : { description }), lines: lines.map((line) => ({ product: { id: line.product.id, name: line.product.name }, quantity: line.quantity, pricingMode: line.pricingMode, catalogUnitPrice: formatMoney(line.catalogUnitPrice), ...(line.appliedUnitPrice === undefined ? {} : { appliedUnitPrice: formatMoney(line.appliedUnitPrice) }), amount: formatMoney(line.amount) })), totalAmount: formatMoney(totalAmount), recordArguments };
  }

  async recordSale(input: RecordInput) {
    limit(input.lines);
    const lines = input.lines.map((line) => {
      if (!isMode(line.pricingMode)) throw new FinanceDomainError("Sale pricing mode is invalid.");
      const catalogUnitPrice = parseMoney(line.catalogUnitPrice); const amount = parseMoney(line.amount);
      const appliedUnitPrice = line.appliedUnitPrice === undefined ? undefined : parseMoney(line.appliedUnitPrice);
      if ((line.pricingMode === "CATALOG" && appliedUnitPrice !== undefined) || (line.pricingMode === "CUSTOM_UNIT" && appliedUnitPrice === undefined) || (line.pricingMode === "CUSTOM_LINE" && appliedUnitPrice !== undefined)) throw new FinanceDomainError("Sale pricing arguments are invalid.");
      if (line.pricingMode !== "CUSTOM_LINE" && !amount.equals((appliedUnitPrice ?? catalogUnitPrice).mul(parsePositiveInteger(line.quantity, "Quantity")))) throw new FinanceDomainError("Sale amount does not match its price and quantity.");
      return { productId: line.productId, quantity: parsePositiveInteger(line.quantity, "Quantity"), pricingMode: line.pricingMode, catalogUnitPrice, ...(appliedUnitPrice === undefined ? {} : { appliedUnitPrice }), amount };
    });
    const totalAmount = lines.reduce((total, line) => total.add(line.amount), new Prisma.Decimal(0));
    if (!parseMoney(input.totalAmount).equals(totalAmount)) throw new FinanceDomainError("Sale total does not match its lines.");
    const result = await this.sales.create({ accountId: input.accountId, categoryId: input.categoryId, date: parseDate(input.date), ...(input.description === undefined ? {} : { description: trimDescription(input.description) }), totalAmount, lines });
    return { currency: "GTQ" as const, sale: { id: result.sale.id, transactionId: result.transaction.id, amount: formatMoney(result.transaction.amount), date: formatDate(result.transaction.date), accountName: result.account.name, categoryName: result.category.name, lines: result.lines.map((line) => ({ productName: line.productName, quantity: line.input.quantity, pricingMode: line.input.pricingMode, amount: formatMoney(line.input.amount), inventoryMovementId: line.movementId })) } };
  }

  async listSales(input: { saleId?: number; startDate?: string; endDate?: string }) {
    const startDate = input.startDate === undefined ? undefined : parseDate(input.startDate, "Start date");
    const endDate = input.endDate === undefined ? undefined : parseDate(input.endDate, "End date");
    if (startDate && endDate && startDate > endDate) throw new FinanceDomainError("Start date must not be after end date.");
    const sales = await this.sales.list({ saleId: input.saleId, startDate, endDate });
    return sales.map((sale) => ({ id: sale.id, transactionId: sale.transactionId, date: formatDate(sale.transaction.date), description: sale.transaction.description, amount: formatMoney(sale.transaction.amount), account: { id: sale.transaction.account.id, name: sale.transaction.account.name }, category: { id: sale.transaction.category.id, name: sale.transaction.category.name }, lines: sale.lines.map((line) => ({ inventoryMovementId: line.inventoryMovementId, product: { id: line.inventoryMovement.product.id, name: line.inventoryMovement.product.name }, quantity: line.inventoryMovement.quantity, pricingMode: line.pricingMode, amount: formatMoney(line.amount) })) }));
  }
}
