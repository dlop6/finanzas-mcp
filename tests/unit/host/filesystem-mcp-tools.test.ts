import { describe, expect, it, vi } from "vitest";
import { filesystemMcpToolMetadata, registerFilesystemMcpTools } from "@/host/orchestration/filesystem-mcp-tools";
import { HostMcpToolRegistry, type McpToolClient } from "@/host/orchestration/mcp-tool-registry";
import { FilesystemWriteOperationDescriber } from "@/host/confirmation/filesystem-write-describer";
import { HostWriteOperationDescriber } from "@/host/confirmation/host-write-describer";
import type { McpTool } from "@/shared/mcp";

const filesystemToolNames = [
  "read_file", "read_text_file", "read_media_file", "read_multiple_files", "write_file", "edit_file", "create_directory",
  "list_directory", "list_directory_with_sizes", "directory_tree", "move_file", "search_files", "get_file_info", "list_allowed_directories",
] as const;

function tool(name: string): McpTool {
  return { name, description: `${name} description`, inputSchema: { type: "object", additionalProperties: false } };
}

describe("Filesystem MCP Host integration", () => {
  it("classifies exactly the pinned official server catalog", async () => {
    expect(Object.keys(filesystemMcpToolMetadata)).toEqual(filesystemToolNames);
    expect(Object.values(filesystemMcpToolMetadata).filter((metadata) => metadata.isWriteOperation)).toHaveLength(4);
    expect(Object.values(filesystemMcpToolMetadata).filter((metadata) => !metadata.isWriteOperation)).toHaveLength(10);

    const client: McpToolClient = {
      toolsList: vi.fn(async () => ({ tools: filesystemToolNames.map(tool) })),
      toolsCall: vi.fn(async () => ({ content: [] })),
    };
    const registry = new HostMcpToolRegistry();
    await registerFilesystemMcpTools(registry, client);

    expect(registry.list()).toHaveLength(14);
    expect(registry.list().filter((entry) => entry.isWriteOperation)).toHaveLength(4);
    expect(registry.resolve("write_file")).toMatchObject({ serverId: "filesystem-mcp", client, isWriteOperation: true });
    expect(client.toolsCall).not.toHaveBeenCalled();
  });

  it("describes every filesystem mutation with exact, escaped arguments", () => {
    const describer = new FilesystemWriteOperationDescriber();
    expect(describer.describe({ toolCallId: "1", serverId: "filesystem-mcp", toolName: "write_file", arguments: { path: "docs/generated/report.md", content: "# Report\n" } }))
      .toBe('Escribir el archivo "docs/generated/report.md" con el contenido exacto "# Report\\n".');
    expect(describer.describe({ toolCallId: "2", serverId: "filesystem-mcp", toolName: "edit_file", arguments: { path: "docs/generated/report.md", edits: [{ oldText: "old", newText: "new" }], dryRun: true } }))
      .toBe('Editar el archivo "docs/generated/report.md": reemplazar "old" por "new". Vista previa: true.');
    expect(describer.describe({ toolCallId: "3", serverId: "filesystem-mcp", toolName: "create_directory", arguments: { path: "docs/generated/archive" } }))
      .toBe('Crear el directorio "docs/generated/archive".');
    expect(describer.describe({ toolCallId: "4", serverId: "filesystem-mcp", toolName: "move_file", arguments: { source: "a.md", destination: "b.md" } }))
      .toBe('Mover "a.md" a "b.md".');
  });

  it("fails closed for unknown filesystem writes and delegates known servers", () => {
    const describer = new FilesystemWriteOperationDescriber();
    expect(() => describer.describe({ toolCallId: "1", serverId: "filesystem-mcp", toolName: "delete_file", arguments: {} }))
      .toThrow(/cannot be described safely/i);
    expect(new HostWriteOperationDescriber().describe({ toolCallId: "2", serverId: "finance-mcp", toolName: "delete_transaction", arguments: { transactionId: 9 } }))
      .toBe("Eliminar la transacción 9.");
  });
});
