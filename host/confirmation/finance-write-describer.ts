import type { PendingWriteOperation } from "@/host/orchestration/chat-orchestrator";
import { ConfirmationError } from "./confirmation-error";

export type WriteOperationDescriber = {
  describe(operation: PendingWriteOperation): string;
};

export const financeWriteToolNames = [
  "record_income",
  "record_expense",
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

function updateFields(args: Record<string, unknown>, fields: readonly [string, string, "text" | "money" | "integer"][]): string {
  const changes = fields.flatMap(([key, label, type]) => {
    if (!Object.hasOwn(args, key)) return [];
    const value = type === "text" ? quoted(args, key) : type === "money" ? money(args, key) : String(integer(args, key));
    return [`${label} = ${value}`];
  });
  return changes.length > 0 ? changes.join(", ") : fail();
}

export class FinanceWriteOperationDescriber implements WriteOperationDescriber {
  describe(operation: PendingWriteOperation): string {
    const args = object(operation.arguments);

    switch (operation.toolName) {
      case "record_income":
        return `Registrar un ingreso de ${money(args, "amount")} en la cuenta ${integer(args, "accountId")}, categoría ${integer(args, "categoryId")}, con fecha ${text(args, "date")}${optionalText(args, "description", ", descripción") ?? ""}.`;
      case "record_expense":
        return `Registrar un gasto de ${money(args, "amount")} en la cuenta ${integer(args, "accountId")}, categoría ${integer(args, "categoryId")}, con fecha ${text(args, "date")}${optionalText(args, "description", ", descripción") ?? ""}.`;
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
