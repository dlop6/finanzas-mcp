import { startFilesystemMcpSessionLocal } from "@/host/mcp-clients/filesystem-mcp-local";
import { startFinanceMcpSessionLocal } from "@/host/mcp-clients/finance-mcp-local";
import { startGitMcpSessionLocal } from "@/host/mcp-clients/git-mcp-local";
import { InMemoryMcpInteractionLogStore, type McpInteractionLogReader } from "@/host/mcp-clients/mcp-interaction-log";
import { type McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
import { registerFilesystemMcpTools } from "@/host/orchestration/filesystem-mcp-tools";
import { registerFinanceMcpTools } from "@/host/orchestration/finance-mcp-tools";
import { registerGitMcpTools } from "@/host/orchestration/git-mcp-tools";
import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";

export type LocalMcpRuntime = {
  registry: HostMcpToolRegistry;
  interactionLogs: McpInteractionLogReader;
  financeClient: McpLifecycleClient;
  filesystemClient: McpLifecycleClient;
  gitClient: McpLifecycleClient;
  close(): Promise<void>;
};

export class LocalMcpRuntimeError extends Error {
  constructor(public readonly code: "START_FAILED" | "INVALID_CATALOG", message: string) {
    super(message);
    this.name = "LocalMcpRuntimeError";
  }
}

export async function startLocalMcpRuntime(): Promise<LocalMcpRuntime> {
  const logs = new InMemoryMcpInteractionLogStore();
  const started: McpLifecycleClient[] = [];

  try {
    const financeClient = await startFinanceMcpSessionLocal({ interactionLogger: logs, onStderr: () => undefined });
    started.push(financeClient);
    const filesystemClient = await startFilesystemMcpSessionLocal({ interactionLogger: logs, onStderr: () => undefined });
    started.push(filesystemClient);
    const gitClient = await startGitMcpSessionLocal({ interactionLogger: logs, onStderr: () => undefined });
    started.push(gitClient);

    const registry = new HostMcpToolRegistry();
    await registerFinanceMcpTools(registry, financeClient);
    await registerFilesystemMcpTools(registry, filesystemClient);
    await registerGitMcpTools(registry, gitClient);
    const tools = registry.list();
    if (tools.length !== 50 || tools.filter((tool) => tool.isWriteOperation).length !== 24) {
      throw new LocalMcpRuntimeError("INVALID_CATALOG", "The local MCP catalog is incomplete.");
    }

    let closed = false;
    return {
      registry,
      interactionLogs: logs,
      financeClient,
      filesystemClient,
      gitClient,
      async close() {
        if (closed) return;
        closed = true;
        await Promise.allSettled([gitClient.close(), filesystemClient.close(), financeClient.close()]);
      },
    };
  } catch (error) {
    await Promise.allSettled(started.reverse().map((client) => client.close()));
    if (error instanceof LocalMcpRuntimeError) throw error;
    throw new LocalMcpRuntimeError("START_FAILED", "Could not start the local MCP runtime.");
  }
}
