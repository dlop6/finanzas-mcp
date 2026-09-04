import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";
import { ConfirmationError } from "./confirmation-error";

type TransactionKind = "INCOME" | "EXPENSE";
export type ResolvedTransactionReferences = { accountName: string; categoryName: string };

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
    const tool = this.registry.resolve("get_transaction_reference_data");
    if (tool.serverId !== "finance-mcp" || tool.isWriteOperation) return fail();
    let result;
    try {
      result = await tool.client.toolsCall(tool.definition.name, { type: kind }, { sessionId });
    } catch {
      return fail();
    }
    if (result.isError || !isRecord(result.structuredContent)) return fail();
    return {
      accountName: namedId(result.structuredContent.accounts, accountId),
      categoryName: namedId(result.structuredContent.categories, categoryId, kind),
    };
  }
}
