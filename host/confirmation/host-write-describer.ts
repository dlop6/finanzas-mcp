import type { PendingWriteOperation } from "@/host/orchestration/chat-orchestrator";
import { ConfirmationError } from "./confirmation-error";
import { FilesystemWriteOperationDescriber } from "./filesystem-write-describer";
import { GitWriteOperationDescriber } from "./git-write-describer";
import { FinanceWriteOperationDescriber, type WriteOperationDescriber, type WriteOperationPresentation } from "./finance-write-describer";
import type { TransactionReferenceResolver } from "./transaction-reference-resolver";

export class HostWriteOperationDescriber implements WriteOperationDescriber {
  private readonly finance: FinanceWriteOperationDescriber;
  private readonly filesystem = new FilesystemWriteOperationDescriber();
  private readonly git = new GitWriteOperationDescriber();

  constructor(transactionReferences?: TransactionReferenceResolver) {
    this.finance = new FinanceWriteOperationDescriber(transactionReferences);
  }

  describe(operation: PendingWriteOperation, context?: { sessionId: string }): string | WriteOperationPresentation | Promise<string | WriteOperationPresentation> {
    if (operation.serverId === "finance-mcp") return this.finance.describe(operation, context);
    if (operation.serverId === "filesystem-mcp") return this.filesystem.describe(operation);
    if (operation.serverId === "git-mcp") return this.git.describe(operation);
    throw new ConfirmationError("UNSUPPORTED_WRITE_DESCRIPTION", "The pending write operation cannot be described safely.");
  }
}
