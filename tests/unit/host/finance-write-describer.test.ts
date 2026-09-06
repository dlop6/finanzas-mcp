import { describe, expect, it, vi } from "vitest";
import {
  FinanceWriteOperationDescriber,
  financeWriteToolNames,
} from "@/host/confirmation/finance-write-describer";

const describer = new FinanceWriteOperationDescriber();

describe("Finance write operation descriptions", () => {
  it("covers exactly the 18 registered Finance MCP writes", () => {
    expect(financeWriteToolNames).toEqual([
      "record_income", "record_expense", "record_transactions_batch", "record_mixed_transactions_batch", "update_transaction", "delete_transaction",
      "record_debt", "update_debt", "mark_debt_paid", "delete_debt",
      "record_receivable", "update_receivable", "mark_receivable_collected", "delete_receivable",
      "create_product", "update_product", "record_inventory_movement", "record_sale",
    ]);
  });

  it("describes exact transaction arguments without changing them", () => {
    const arguments_ = { accountId: 1, categoryId: 2, amount: "500.00", date: "2026-08-23", description: "Venta\nmayorista" };
    const description = describer.describe({ toolCallId: "call-1", serverId: "finance-mcp", toolName: "record_income", arguments: arguments_ });

    expect(description).toBe('Registrar un ingreso de GTQ 500.00 en la cuenta 1, categoría 2, con fecha 2026-08-23, descripción "Venta\\nmayorista".');
    expect(arguments_).toEqual({ accountId: 1, categoryId: 2, amount: "500.00", date: "2026-08-23", description: "Venta\nmayorista" });
  });

  it("uses verified account and category names when a session-aware resolver is available", async () => {
    const resolve = vi.fn().mockResolvedValue({ accountName: "Banco", categoryName: "Otros ingresos" });
    const referenceAware = new FinanceWriteOperationDescriber({ resolve } as never);

    await expect(referenceAware.describe(
      { toolCallId: "call-verified", serverId: "finance-mcp", toolName: "record_income", arguments: { accountId: 2, categoryId: 3, amount: "3500.00", date: "2026-11-16", description: "prueba" } },
      { sessionId: "session-a" },
    )).resolves.toBe('Registrar un ingreso de GTQ 3500.00 en la cuenta Banco, categoría Otros ingresos, con fecha 2026-11-16, descripción "prueba".');
    expect(resolve).toHaveBeenCalledWith("session-a", "INCOME", 2, 3);
  });

  it("describes a mixed batch with verified names in original order", async () => {
    const resolveMixedBatch = vi.fn().mockResolvedValue([
      { accountName: "Efectivo", categoryName: "Ventas" },
      { accountName: "Banco", categoryName: "Marketing" },
    ]);
    const referenceAware = new FinanceWriteOperationDescriber({ resolveMixedBatch } as never);
    const result = await referenceAware.describe(
      { toolCallId: "mixed", serverId: "finance-mcp", toolName: "record_mixed_transactions_batch", arguments: { transactions: [
        { type: "INCOME", accountId: 1, categoryId: 1, amount: "5000.00", date: "2026-09-05" },
        { type: "EXPENSE", accountId: 2, categoryId: 5, amount: "1200.00", date: "2026-09-05", description: "Campaña" },
      ] } },
      { sessionId: "session-a" },
    );
    expect(result).toMatchObject({
      preview: { kind: "mixed_transaction_batch", items: [
        { type: "INCOME", accountName: "Efectivo", categoryName: "Ventas" },
        { type: "EXPENSE", accountName: "Banco", categoryName: "Marketing", description: "Campaña" },
      ] },
    });
    expect(resolveMixedBatch).toHaveBeenCalledWith("session-a", expect.any(Array));
  });

  it("describes updates in stable field order and fails closed for unknown writes", () => {
    expect(describer.describe({ toolCallId: "call-2", serverId: "finance-mcp", toolName: "update_product", arguments: { productId: 7, salePrice: "12.50", name: "Arroz" } })).toBe(
      'Actualizar el producto 7: nombre = "Arroz", precio de venta = GTQ 12.50.',
    );
    try {
      describer.describe({ toolCallId: "call-3", serverId: "other", toolName: "delete_everything", arguments: {} });
      throw new Error("Expected description to fail.");
    } catch (error) {
      expect(error).toMatchObject({ code: "UNSUPPORTED_WRITE_DESCRIPTION" });
    }
  });

  it.each([
    ["record_expense", { accountId: 1, categoryId: 2, amount: "1.00", date: "2026-08-24" }],
    ["update_transaction", { transactionId: 1, amount: "1.00" }],
    ["delete_transaction", { transactionId: 1 }],
    ["record_debt", { description: "Debt", amount: "1.00", dueDate: "2026-08-25", priority: "HIGH" }],
    ["update_debt", { debtId: 1, priority: "LOW" }],
    ["mark_debt_paid", { debtId: 1 }],
    ["delete_debt", { debtId: 1 }],
    ["record_receivable", { description: "Receivable", amount: "1.00", expectedDate: "2026-08-25", confidence: "CONFIRMED" }],
    ["update_receivable", { receivableId: 1, confidence: "UNCONFIRMED" }],
    ["mark_receivable_collected", { receivableId: 1 }],
    ["delete_receivable", { receivableId: 1 }],
    ["create_product", { name: "Product", stock: 1, unitCost: "1.00", salePrice: "2.00", minimumStock: 0 }],
    ["record_inventory_movement", { productId: 1, type: "IN", quantity: 1, date: "2026-08-24" }],
  ])("has a deterministic template for %s", (toolName, arguments_) => {
    const presentation = describer.describe({
      toolCallId: "call",
      serverId: "finance-mcp",
      toolName,
      arguments: arguments_,
    });
    if (presentation instanceof Promise) throw new Error("The synchronous describer must not return a promise.");
    expect(typeof presentation === "string" ? presentation : presentation.description).toMatch(/^.+\.$/);
  });
});
