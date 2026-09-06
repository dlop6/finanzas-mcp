import type { PendingWriteOperation } from "@/host/orchestration/chat-orchestrator";
import { ConfirmationError } from "./confirmation-error";
import type { TransactionReferenceResolver } from "./transaction-reference-resolver";

export type WriteOperationDescriber = {
  describe(operation: PendingWriteOperation, context?: { sessionId: string }): string | WriteOperationPresentation | Promise<string | WriteOperationPresentation>;
};

export type TransactionBatchPreview = {
  kind: "transaction_batch";
  transactionType: "INCOME" | "EXPENSE";
  currency: "GTQ";
  items: Array<{ accountName: string; categoryName: string; amount: string; date: string; description?: string }>;
};

export type MixedTransactionBatchPreview = {
  kind: "mixed_transaction_batch";
  currency: "GTQ";
  items: Array<{ type: "INCOME" | "EXPENSE"; accountName: string; categoryName: string; amount: string; date: string; description?: string }>;
};

export type SalePreview = {
  kind: "sale";
  currency: "GTQ";
  accountName: string;
  categoryName: string;
  date: string;
  description?: string;
  lines: Array<{ productName: string; quantity: number; pricingLabel: string; catalogUnitPrice: string; appliedUnitPrice?: string; amount: string }>;
  totalAmount: string;
};
export type TransactionPreview = TransactionBatchPreview | MixedTransactionBatchPreview | SalePreview;
export type WriteOperationPresentation = { description: string; preview?: TransactionPreview };

export const financeWriteToolNames = [
  "record_income",
  "record_expense",
  "record_transactions_batch",
  "record_mixed_transactions_batch",
  "update_transaction",
  "delete_transaction",
  "record_debt",
  "update_debt",
  "mark_debt_paid",
  "delete_debt",
  "record_receivable",
  "update_receivable",
  "mark_receivable_collected",
  "delete_receivable",
  "create_product",
  "update_product",
  "record_inventory_movement",
  "record_sale",
] as const;

function fail(): never {
  throw new ConfirmationError("UNSUPPORTED_WRITE_DESCRIPTION", "The pending write operation cannot be described safely.");
}

function object(value: Record<string, unknown>): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fail();
}

function integer(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  return typeof value === "number" && Number.isInteger(value) ? value : fail();
}

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : fail();
}

function quoted(args: Record<string, unknown>, key: string): string {
  return JSON.stringify(text(args, key));
}

function money(args: Record<string, unknown>, key: string): string {
  return `GTQ ${text(args, key)}`;
}

function optionalText(args: Record<string, unknown>, key: string, label: string): string | null {
  return Object.hasOwn(args, key) ? `${label} ${quoted(args, key)}` : null;
}

function batchTransactions(args: Record<string, unknown>): Array<{ accountId: number; categoryId: number; amount: string; date: string; description?: string }> {
  const values = args.transactions;
  if (!Array.isArray(values) || values.length < 2 || values.length > 25) return fail();
  return values.map((value) => {
    const item = object(value as Record<string, unknown>);
    const result = { accountId: integer(item, "accountId"), categoryId: integer(item, "categoryId"), amount: text(item, "amount"), date: text(item, "date") };
    return Object.hasOwn(item, "description") ? { ...result, description: text(item, "description") } : result;
  });
}

function mixedBatchTransactions(args: Record<string, unknown>): Array<{ type: "INCOME" | "EXPENSE"; accountId: number; categoryId: number; amount: string; date: string; description?: string }> {
  const values = args.transactions;
  if (!Array.isArray(values) || values.length < 2 || values.length > 25) return fail();
  const transactions = values.map((value) => {
    const item = object(value as Record<string, unknown>);
    const type = text(item, "type");
    if (type !== "INCOME" && type !== "EXPENSE") return fail();
    const result = { type: type as "INCOME" | "EXPENSE", accountId: integer(item, "accountId"), categoryId: integer(item, "categoryId"), amount: text(item, "amount"), date: text(item, "date") };
    return Object.hasOwn(item, "description") ? { ...result, description: text(item, "description") } : result;
  });
  return new Set(transactions.map((transaction) => transaction.type)).size === 2 ? transactions : fail();
}

function saleLines(args: Record<string, unknown>): Array<{ productId: number; quantity: number; pricingMode: "CATALOG" | "CUSTOM_UNIT" | "CUSTOM_LINE"; catalogUnitPrice: string; appliedUnitPrice?: string; amount: string }> {
  const values = args.lines;
  if (!Array.isArray(values) || values.length < 1 || values.length > 25) return fail();
  return values.map((value) => {
    const item = object(value as Record<string, unknown>);
    const pricingMode = text(item, "pricingMode");
    if (pricingMode !== "CATALOG" && pricingMode !== "CUSTOM_UNIT" && pricingMode !== "CUSTOM_LINE") return fail();
    const line = { productId: integer(item, "productId"), quantity: integer(item, "quantity"), pricingMode: pricingMode as "CATALOG" | "CUSTOM_UNIT" | "CUSTOM_LINE", catalogUnitPrice: text(item, "catalogUnitPrice"), amount: text(item, "amount") };
    return Object.hasOwn(item, "appliedUnitPrice") ? { ...line, appliedUnitPrice: text(item, "appliedUnitPrice") } : line;
  });
}

function updateFields(args: Record<string, unknown>, fields: readonly [string, string, "text" | "money" | "integer"][]): string {
  const changes = fields.flatMap(([key, label, type]) => {
    if (!Object.hasOwn(args, key)) return [];
    const value = type === "text" ? quoted(args, key) : type === "money" ? money(args, key) : String(integer(args, key));
    return [`${label} = ${value}`];
  });
  return changes.length > 0 ? changes.join(", ") : fail();
}

export class FinanceWriteOperationDescriber implements WriteOperationDescriber {
  constructor(private readonly transactionReferences?: TransactionReferenceResolver) {}

  describe(operation: PendingWriteOperation, context?: { sessionId: string }): string | WriteOperationPresentation | Promise<string | WriteOperationPresentation> {
    const args = object(operation.arguments);

    switch (operation.toolName) {
      case "record_income":
      case "record_expense": {
        const kind = operation.toolName === "record_income" ? "INCOME" : "EXPENSE";
        const accountId = integer(args, "accountId");
        const categoryId = integer(args, "categoryId");
        const format = (references: { accountName: string; categoryName: string }) =>
          `Registrar un ${kind === "INCOME" ? "ingreso" : "gasto"} de ${money(args, "amount")} en la cuenta ${references.accountName}, categoría ${references.categoryName}, con fecha ${text(args, "date")}${optionalText(args, "description", ", descripción") ?? ""}.`;
        if (this.transactionReferences && context) {
          return this.transactionReferences.resolve(context.sessionId, kind, accountId, categoryId).then(format);
        }
        return format({ accountName: String(accountId), categoryName: String(categoryId) });
      }
      case "record_transactions_batch": {
        const type = text(args, "type");
        if (type !== "INCOME" && type !== "EXPENSE") return fail();
        const transactions = batchTransactions(args);
        const description = `Registrar ${transactions.length} ${type === "INCOME" ? "ingresos" : "gastos"} en una sola operación. No se guardará ninguno si una fila falla.`;
        if (!this.transactionReferences || !context) return { description };
        return this.transactionReferences.resolveBatch(context.sessionId, type, transactions).then((references) => ({
          description,
          preview: {
            kind: "transaction_batch" as const,
            transactionType: type,
            currency: "GTQ" as const,
            items: transactions.map((transaction, index) => ({
              accountName: references[index]!.accountName,
              categoryName: references[index]!.categoryName,
              amount: transaction.amount,
              date: transaction.date,
              ...(transaction.description === undefined ? {} : { description: transaction.description }),
            })),
          },
        }));
      }
      case "record_mixed_transactions_batch": {
        const transactions = mixedBatchTransactions(args);
        const description = `Registrar ${transactions.length} movimientos, incluidos ingresos y gastos, en una sola operación. No se guardará ninguno si una fila falla.`;
        if (!this.transactionReferences || !context) return { description };
        return this.transactionReferences.resolveMixedBatch(context.sessionId, transactions).then((references) => ({
          description,
          preview: {
            kind: "mixed_transaction_batch" as const,
            currency: "GTQ" as const,
            items: transactions.map((transaction, index) => ({
              type: transaction.type,
              accountName: references[index]!.accountName,
              categoryName: references[index]!.categoryName,
              amount: transaction.amount,
              date: transaction.date,
              ...(transaction.description === undefined ? {} : { description: transaction.description }),
            })),
          },
        }));
      }
      case "record_sale": {
        const accountId = integer(args, "accountId");
        const categoryId = integer(args, "categoryId");
        const date = text(args, "date");
        const lines = saleLines(args);
        const format = (references: { accountName: string; categoryName: string; productNames: string[] }): WriteOperationPresentation => ({
          description: `Registrar una venta con un ingreso y ${lines.length} salida${lines.length === 1 ? "" : "s"} de inventario en una sola operación. Si una línea falla, no se guardará ningún cambio.`,
          preview: { kind: "sale", currency: "GTQ", accountName: references.accountName, categoryName: references.categoryName, date, ...(Object.hasOwn(args, "description") ? { description: text(args, "description") } : {}), lines: lines.map((line, index) => ({ productName: references.productNames[index]!, quantity: line.quantity, pricingLabel: line.pricingMode === "CATALOG" ? "Precio de catálogo" : line.pricingMode === "CUSTOM_UNIT" ? "Precio unitario aplicado" : "Monto aplicado por línea", catalogUnitPrice: line.catalogUnitPrice, ...(line.appliedUnitPrice === undefined ? {} : { appliedUnitPrice: line.appliedUnitPrice }), amount: line.amount })), totalAmount: text(args, "totalAmount") },
        });
        if (!this.transactionReferences || !context) return { description: "Registrar una venta con su ingreso y sus salidas de inventario como una sola operación." };
        return this.transactionReferences.resolveSale(context.sessionId, accountId, categoryId, lines.map((line) => line.productId)).then(format);
      }
      case "update_transaction":
        return `Actualizar la transacción ${integer(args, "transactionId")}: ${updateFields(args, [["accountId", "cuenta", "integer"], ["categoryId", "categoría", "integer"], ["amount", "monto", "money"], ["date", "fecha", "text"], ["description", "descripción", "text"]])}.`;
      case "delete_transaction":
        return `Eliminar la transacción ${integer(args, "transactionId")}.`;
      case "record_debt":
        return `Registrar la deuda ${quoted(args, "description")} por ${money(args, "amount")}, con vencimiento ${text(args, "dueDate")} y prioridad ${text(args, "priority")}.`;
      case "update_debt":
        return `Actualizar la deuda ${integer(args, "debtId")}: ${updateFields(args, [["description", "descripción", "text"], ["amount", "monto", "money"], ["dueDate", "vencimiento", "text"], ["priority", "prioridad", "text"]])}.`;
      case "mark_debt_paid":
        return `Marcar la deuda ${integer(args, "debtId")} como pagada.`;
      case "delete_debt":
        return `Eliminar la deuda ${integer(args, "debtId")}.`;
      case "record_receivable":
        return `Registrar la cuenta por cobrar ${quoted(args, "description")} por ${money(args, "amount")}, esperada para ${text(args, "expectedDate")} con confianza ${text(args, "confidence")}.`;
      case "update_receivable":
        return `Actualizar la cuenta por cobrar ${integer(args, "receivableId")}: ${updateFields(args, [["description", "descripción", "text"], ["amount", "monto", "money"], ["expectedDate", "fecha esperada", "text"], ["confidence", "confianza", "text"]])}.`;
      case "mark_receivable_collected":
        return `Marcar la cuenta por cobrar ${integer(args, "receivableId")} como cobrada.`;
      case "delete_receivable":
        return `Eliminar la cuenta por cobrar ${integer(args, "receivableId")}.`;
      case "create_product":
        return `Crear el producto ${quoted(args, "name")} con stock inicial ${integer(args, "stock")}, costo unitario ${money(args, "unitCost")}, precio de venta ${money(args, "salePrice")} y stock mínimo ${integer(args, "minimumStock")}.`;
      case "update_product":
        return `Actualizar el producto ${integer(args, "productId")}: ${updateFields(args, [["name", "nombre", "text"], ["unitCost", "costo unitario", "money"], ["salePrice", "precio de venta", "money"], ["minimumStock", "stock mínimo", "integer"]])}.`;
      case "record_inventory_movement":
        return `Registrar una ${text(args, "type") === "IN" ? "entrada" : text(args, "type") === "OUT" ? "salida" : fail()} de inventario para el producto ${integer(args, "productId")}, cantidad ${integer(args, "quantity")}, fecha ${text(args, "date")}${optionalText(args, "note", ", nota") ?? ""}.`;
      default:
        return fail();
    }
  }
}
