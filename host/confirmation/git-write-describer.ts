import type { PendingWriteOperation } from "@/host/orchestration/chat-orchestrator";
import { ConfirmationError } from "./confirmation-error";
import type { WriteOperationDescriber } from "./finance-write-describer";

export const gitWriteToolNames = ["git_commit", "git_add", "git_reset", "git_create_branch", "git_checkout"] as const;

function fail(): never {
  throw new ConfirmationError("UNSUPPORTED_WRITE_DESCRIPTION", "The pending write operation cannot be described safely.");
}

function text(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" && args[key].trim().length > 0 ? args[key] : fail();
}

function quoted(args: Record<string, unknown>, key: string): string {
  return JSON.stringify(text(args, key));
}

function repository(args: Record<string, unknown>): string {
  return quoted(args, "repo_path");
}

function files(args: Record<string, unknown>): string {
  const value = args.files;
  if (!Array.isArray(value) || value.length === 0 || value.some((file) => typeof file !== "string" || file.trim().length === 0)) return fail();
  return value.map((file) => JSON.stringify(file)).join(", ");
}

export class GitWriteOperationDescriber implements WriteOperationDescriber {
  describe(operation: PendingWriteOperation): string {
    if (operation.serverId !== "git-mcp") return fail();
    const args = operation.arguments;
    switch (operation.toolName) {
      case "git_add": return `Agregar al staging del repositorio ${repository(args)} los archivos ${files(args)}.`;
      case "git_commit": return `Crear un commit en el repositorio ${repository(args)} con el mensaje exacto ${quoted(args, "message")}.`;
      case "git_reset": return `Retirar todos los cambios del staging en el repositorio ${repository(args)} sin borrar archivos.`;
      case "git_create_branch": return `Crear la rama ${quoted(args, "branch_name")} en el repositorio ${repository(args)}${Object.hasOwn(args, "base_branch") ? ` desde ${quoted(args, "base_branch")}` : ""}.`;
      case "git_checkout": return `Cambiar el repositorio ${repository(args)} a la rama ${quoted(args, "branch_name")}.`;
      default: return fail();
    }
  }
}
