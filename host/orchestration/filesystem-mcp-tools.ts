import type { McpToolClient } from "./mcp-tool-registry";
import { HostMcpToolRegistry, type HostToolMetadata } from "./mcp-tool-registry";
import { FILESYSTEM_MCP_SERVER_ID } from "@/host/mcp-clients/filesystem-mcp-local";

export { FILESYSTEM_MCP_SERVER_ID };

export const filesystemMcpToolMetadata = {
  read_file: { isWriteOperation: false },
  read_text_file: { isWriteOperation: false },
  read_media_file: { isWriteOperation: false },
  read_multiple_files: { isWriteOperation: false },
  write_file: { isWriteOperation: true },
  edit_file: { isWriteOperation: true },
  create_directory: { isWriteOperation: true },
  list_directory: { isWriteOperation: false },
  list_directory_with_sizes: { isWriteOperation: false },
  directory_tree: { isWriteOperation: false },
  move_file: { isWriteOperation: true },
  search_files: { isWriteOperation: false },
  get_file_info: { isWriteOperation: false },
  list_allowed_directories: { isWriteOperation: false },
} as const satisfies Readonly<Record<string, HostToolMetadata>>;

export async function registerFilesystemMcpTools(
  registry: HostMcpToolRegistry,
  client: McpToolClient,
): Promise<void> {
  await registry.registerServer({
    serverId: FILESYSTEM_MCP_SERVER_ID,
    client,
    metadata: filesystemMcpToolMetadata,
  });
}
