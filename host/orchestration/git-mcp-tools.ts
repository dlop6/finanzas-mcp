import type { McpToolClient } from "./mcp-tool-registry";
import { HostMcpToolRegistry, type HostToolMetadata } from "./mcp-tool-registry";
import { GIT_MCP_SERVER_ID } from "@/host/mcp-clients/git-mcp-local";

export { GIT_MCP_SERVER_ID };

export const gitMcpToolMetadata = {
  git_status: { isWriteOperation: false },
  git_diff_unstaged: { isWriteOperation: false },
  git_diff_staged: { isWriteOperation: false },
  git_diff: { isWriteOperation: false },
  git_commit: { isWriteOperation: true },
  git_add: { isWriteOperation: true },
  git_reset: { isWriteOperation: true },
  git_log: { isWriteOperation: false },
  git_create_branch: { isWriteOperation: true },
  git_checkout: { isWriteOperation: true },
  git_show: { isWriteOperation: false },
  git_branch: { isWriteOperation: false },
} as const satisfies Readonly<Record<string, HostToolMetadata>>;

export async function registerGitMcpTools(registry: HostMcpToolRegistry, client: McpToolClient): Promise<void> {
  await registry.registerServer({ serverId: GIT_MCP_SERVER_ID, client, metadata: gitMcpToolMetadata });
}
