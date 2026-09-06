import type { FinanceToolDefinition } from "./registry";
import { isExpectedFinanceError } from "@/servers/finance-mcp/services";
import type { TransactionService } from "@/servers/finance-mcp/services";
import type { McpCallToolResult } from "@/shared/mcp";
import { MONEY_PATTERN } from "@/servers/finance-mcp/services";

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const positiveId = { type: "integer", minimum: 1 } as const;
const money = { type: "string", pattern: MONEY_PATTERN } as const;
const date = { type: "string", pattern: DATE_PATTERN } as const;
const description = { type: "string", minLength: 1 } as const;
const batchTransaction = {
  type: "object",
  additionalProperties: false,
  required: ["accountId", "categoryId", "amount", "date"],
  properties: { accountId: positiveId, categoryId: positiveId, amount: money, date, description },
} as const;
const mixedBatchTransaction = {
  type: "object",
  additionalProperties: false,
  required: ["type", "accountId", "categoryId", "amount", "date"],
  properties: { type: { type: "string", enum: ["INCOME", "EXPENSE"] }, accountId: positiveId, categoryId: positiveId, amount: money, date, description },
} as const;

function success(text: string, structuredContent: Record<string, unknown>): McpCallToolResult {
  return { content: [{ type: "text", text }], structuredContent };
}
function expectedError(error: unknown): McpCallToolResult {
  if (!isExpectedFinanceError(error)) throw error;
  return { content: [{ type: "text", text: error.message }], isError: true };
}
function guarded<T>(operation: () => Promise<T>, format: (value: T) => McpCallToolResult): () => Promise<McpCallToolResult> {
  return async () => { try { return format(await operation()); } catch (error) { return expectedError(error); } };
}

export function createTransactionTools(service: TransactionService): FinanceToolDefinition[] {
  return [
    {
      name: "record_income", description: "Record an income transaction.", isWriteOperation: true,
      inputSchema: { type: "object", additionalProperties: false, required: ["accountId", "categoryId", "amount", "date"], properties: { accountId: positiveId, categoryId: positiveId, amount: money, date, description } },
      handler: (args) => guarded(() => service.recordIncome(args as never), (result) => success("Income recorded.", result))(),
    },
    {
      name: "record_expense", description: "Record an expense transaction.", isWriteOperation: true,
      inputSchema: { type: "object", additionalProperties: false, required: ["accountId", "categoryId", "amount", "date"], properties: { accountId: positiveId, categoryId: positiveId, amount: money, date, description } },
      handler: (args) => guarded(() => service.recordExpense(args as never), (result) => success("Expense recorded.", result))(),
    },
    {
      name: "record_transactions_batch", description: "Record a homogeneous batch of 2 to 25 income or expense transactions atomically.", isWriteOperation: true,
      inputSchema: {
        type: "object", additionalProperties: false, required: ["type", "transactions"],
        properties: { type: { type: "string", enum: ["INCOME", "EXPENSE"] }, transactions: { type: "array", minItems: 2, maxItems: 25, items: batchTransaction } },
      },
      handler: (args) => guarded(() => service.recordBatch(args as never), (result) => success("Transaction batch recorded.", result))(),
    },
    {
      name: "record_mixed_transactions_batch", description: "Record a mixed batch of 2 to 25 income and expense transactions atomically.", isWriteOperation: true,
      inputSchema: {
        type: "object", additionalProperties: false, required: ["transactions"],
        properties: { transactions: { type: "array", minItems: 2, maxItems: 25, items: mixedBatchTransaction } },
      },
      handler: (args) => guarded(() => service.recordMixedBatch(args as never), (result) => success("Mixed transaction batch recorded.", result))(),
    },
    {
      name: "list_transactions", description: "List financial transactions.", isWriteOperation: false,
      inputSchema: { type: "object", additionalProperties: false, properties: { startDate: date, endDate: date, type: { type: "string", enum: ["INCOME", "EXPENSE"] }, categoryId: positiveId, accountId: positiveId } },
      handler: (args) => guarded(() => service.listTransactions(args as never), (transactions) => success("Transactions listed.", { currency: "GTQ", transactions }))(),
    },
    {
      name: "update_transaction", description: "Update a financial transaction without changing its type.", isWriteOperation: true,
      inputSchema: { type: "object", additionalProperties: false, required: ["transactionId"], anyOf: [{ properties: { accountId: positiveId }, required: ["accountId"] }, { properties: { categoryId: positiveId }, required: ["categoryId"] }, { properties: { amount: money }, required: ["amount"] }, { properties: { date }, required: ["date"] }, { properties: { description }, required: ["description"] }], properties: { transactionId: positiveId, accountId: positiveId, categoryId: positiveId, amount: money, date, description } },
      handler: (args) => guarded(() => service.updateTransaction(args as never), (result) => success("Transaction updated.", result))(),
    },
    {
      name: "delete_transaction", description: "Delete a financial transaction.", isWriteOperation: true,
      inputSchema: { type: "object", additionalProperties: false, required: ["transactionId"], properties: { transactionId: positiveId } },
      handler: (args) => guarded(() => service.deleteTransaction(args.transactionId as number), (result) => success("Transaction deleted.", result))(),
    },
  ];
}
