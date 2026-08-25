import type { PendingWriteOperation } from "@/host/orchestration/chat-orchestrator";
import { ConfirmationError } from "./confirmation-error";
import { FilesystemWriteOperationDescriber } from "./filesystem-write-describer";
import { FinanceWriteOperationDescriber, type WriteOperationDescriber } from "./finance-write-describer";

export class HostWriteOperationDescriber implements WriteOperationDescriber {
  private readonly finance = new FinanceWriteOperationDescriber();
  private readonly filesystem = new FilesystemWriteOperationDescriber();

  describe(operation: PendingWriteOperation): string {
    if (operation.serverId === "finance-mcp") return this.finance.describe(operation);
    if (operation.serverId === "filesystem-mcp") return this.filesystem.describe(operation);
    throw new ConfirmationError("UNSUPPORTED_WRITE_DESCRIPTION", "The pending write operation cannot be described safely.");
  }
}
