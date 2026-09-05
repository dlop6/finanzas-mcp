import { startFilesystemMcpSessionLocal } from "@/host/mcp-clients/filesystem-mcp-local";
import { startFinanceMcpSession, type StartFinanceMcpSessionOptions } from "@/host/mcp-clients/finance-mcp-client";
import { startGitMcpSessionLocal } from "@/host/mcp-clients/git-mcp-local";
import { InMemoryMcpInteractionLogStore, type McpInteractionLogReader } from "@/host/mcp-clients/mcp-interaction-log";
import { type McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
import { registerFilesystemMcpTools } from "@/host/orchestration/filesystem-mcp-tools";
import { registerFinanceMcpTools } from "@/host/orchestration/finance-mcp-tools";
import { registerGitMcpTools } from "@/host/orchestration/git-mcp-tools";
import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";

export type HostMcpRuntime = {
  registry: HostMcpToolRegistry;
  interactionLogs: McpInteractionLogReader;
  financeClient: McpLifecycleClient;
  filesystemClient: McpLifecycleClient;
  gitClient: McpLifecycleClient;
  close(): Promise<void>;
};

export type HostMcpRuntimeStage = "finance" | "filesystem" | "git" | "discovery";

export class HostMcpRuntimeError extends Error {
  constructor(
    public readonly code: "START_FAILED" | "INVALID_CATALOG",
    message: string,
    public readonly stage: HostMcpRuntimeStage = "discovery",
  ) {
    super(message);
    this.name = "HostMcpRuntimeError";
  }
}

export async function startHostMcpRuntime(
  options: { finance?: StartFinanceMcpSessionOptions } = {},
): Promise<HostMcpRuntime> {
  const logs = new InMemoryMcpInteractionLogStore();
  const started: McpLifecycleClient[] = [];
  let stage: HostMcpRuntimeStage = "finance";

  try {
    const financeClient = await startFinanceMcpSession({
      ...options.finance,
      interactionLogger: logs,
      onStderr: () => undefined,
    });
    started.push(financeClient);
    stage = "filesystem";
    const filesystemClient = await startFilesystemMcpSessionLocal({ interactionLogger: logs, onStderr: () => undefined });
    started.push(filesystemClient);
    stage = "git";
    const gitClient = await startGitMcpSessionLocal({ interactionLogger: logs, onStderr: () => undefined });
    started.push(gitClient);

    stage = "discovery";
    const registry = new HostMcpToolRegistry();
    await registerFinanceMcpTools(registry, financeClient);
    await registerFilesystemMcpTools(registry, filesystemClient);
    await registerGitMcpTools(registry, gitClient);
    const tools = registry.list();
    if (tools.length !== 52 || tools.filter((tool) => tool.isWriteOperation).length !== 25) {
      throw new HostMcpRuntimeError("INVALID_CATALOG", "The Host MCP catalog is incomplete.", stage);
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
    if (error instanceof HostMcpRuntimeError) throw error;
    throw new HostMcpRuntimeError("START_FAILED", "Could not start the Host MCP runtime.", stage);
  }
}
