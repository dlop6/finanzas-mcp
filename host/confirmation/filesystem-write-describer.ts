import type { PendingWriteOperation } from "@/host/orchestration/chat-orchestrator";
import { ConfirmationError } from "./confirmation-error";
import type { WriteOperationDescriber } from "./finance-write-describer";

export const filesystemWriteToolNames = ["write_file", "edit_file", "create_directory", "move_file"] as const;

function fail(): never {
  throw new ConfirmationError("UNSUPPORTED_WRITE_DESCRIPTION", "The pending write operation cannot be described safely.");
}

function text(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? args[key] as string : fail();
}

function boolean(args: Record<string, unknown>, key: string): boolean {
  return typeof args[key] === "boolean" ? args[key] as boolean : fail();
}

function quoted(args: Record<string, unknown>, key: string): string {
  return JSON.stringify(text(args, key));
}

function edits(args: Record<string, unknown>): string {
  const value = args.edits;
  if (!Array.isArray(value) || value.length === 0) return fail();
  const lines = value.map((edit) => {
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) return fail();
    const record = edit as Record<string, unknown>;
    if (typeof record.oldText !== "string" || typeof record.newText !== "string") return fail();
    return `reemplazar ${JSON.stringify(record.oldText)} por ${JSON.stringify(record.newText)}`;
  });
  return lines.join("; ");
}

export class FilesystemWriteOperationDescriber implements WriteOperationDescriber {
  describe(operation: PendingWriteOperation): string {
    if (operation.serverId !== "filesystem-mcp") return fail();
    const args = operation.arguments;

    switch (operation.toolName) {
      case "write_file":
        return `Escribir el archivo ${quoted(args, "path")} con el contenido exacto ${quoted(args, "content")}.`;
      case "edit_file":
        return `Editar el archivo ${quoted(args, "path")}: ${edits(args)}. Vista previa: ${Object.hasOwn(args, "dryRun") ? String(boolean(args, "dryRun")) : "false"}.`;
      case "create_directory":
        return `Crear el directorio ${quoted(args, "path")}.`;
      case "move_file":
        return `Mover ${quoted(args, "source")} a ${quoted(args, "destination")}.`;
      default:
        return fail();
    }
  }
}
