import type { McpCallToolResult } from "@/shared/mcp";
import { isExpectedFinanceError, type TransactionReferenceService } from "@/servers/finance-mcp/services";
import type { FinanceToolDefinition } from "./registry";

function guarded(operation: () => Promise<Record<string, unknown>>): Promise<McpCallToolResult> {
  return operation()
    .then((structuredContent) => ({ content: [{ type: "text" as const, text: "Transaction reference data retrieved." }], structuredContent }))
    .catch((error: unknown) => {
      if (!isExpectedFinanceError(error)) throw error;
      return { content: [{ type: "text" as const, text: error.message }], isError: true };
    });
}

export function createTransactionReferenceTools(service: TransactionReferenceService): FinanceToolDefinition[] {
  return [{
    name: "get_transaction_reference_data",
    description: "Get the accounts and compatible categories needed to prepare an income or expense transaction.",
    isWriteOperation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: { type: { type: "string", enum: ["INCOME", "EXPENSE"] } },
    },
    handler: (arguments_) => guarded(() => service.getReferenceData(arguments_.type as "INCOME" | "EXPENSE")),
  }];
}
