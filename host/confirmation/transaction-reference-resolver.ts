import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";
import { ConfirmationError } from "./confirmation-error";

type TransactionKind = "INCOME" | "EXPENSE";
export type ResolvedTransactionReferences = { accountName: string; categoryName: string };
export type BatchTransactionReferenceInput = { accountId: number; categoryId: number };
export type MixedBatchTransactionReferenceInput = BatchTransactionReferenceInput & { type: TransactionKind };

function fail(): never {
  throw new ConfirmationError("TRANSACTION_REFERENCE_LOOKUP_FAILED", "The transaction references could not be verified.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function namedId(values: unknown, id: number, expectedType?: string): string {
  if (!Array.isArray(values)) return fail();
  const value = values.find((entry) => isRecord(entry) && entry.id === id && typeof entry.name === "string" && (!expectedType || entry.type === expectedType));
  return isRecord(value) && typeof value.name === "string" ? value.name : fail();
}

/** Resolves user-facing labels through the registered Finance MCP client, never through persistence internals. */
export class TransactionReferenceResolver {
  constructor(private readonly registry: HostMcpToolRegistry) {}

  async resolve(sessionId: string, kind: TransactionKind, accountId: number, categoryId: number): Promise<ResolvedTransactionReferences> {
    const content = await this.getContent(sessionId, kind);
    return {
      accountName: namedId(content.accounts, accountId),
      categoryName: namedId(content.categories, categoryId, kind),
    };
  }

  async resolveBatch(sessionId: string, kind: TransactionKind, transactions: readonly BatchTransactionReferenceInput[]): Promise<ResolvedTransactionReferences[]> {
    const content = await this.getContent(sessionId, kind);
    return transactions.map(({ accountId, categoryId }) => ({
      accountName: namedId(content.accounts, accountId),
      categoryName: namedId(content.categories, categoryId, kind),
    }));
  }

  async resolveMixedBatch(sessionId: string, transactions: readonly MixedBatchTransactionReferenceInput[]): Promise<ResolvedTransactionReferences[]> {
    const [income, expense] = await Promise.all([this.getContent(sessionId, "INCOME"), this.getContent(sessionId, "EXPENSE")]);
    return transactions.map(({ accountId, categoryId, type }) => {
      const content = type === "INCOME" ? income : expense;
      return {
        accountName: namedId(content.accounts, accountId),
        categoryName: namedId(content.categories, categoryId, type),
      };
    });
  }

  private async getContent(sessionId: string, kind: TransactionKind): Promise<Record<string, unknown>> {
    const tool = this.registry.resolve("get_transaction_reference_data");
    if (tool.serverId !== "finance-mcp" || tool.isWriteOperation) return fail();
    let result;
    try {
      result = await tool.client.toolsCall(tool.definition.name, { type: kind }, { sessionId });
    } catch {
      return fail();
    }
    if (result.isError || !isRecord(result.structuredContent)) return fail();
    return structuredClone(result.structuredContent);
  }
}
