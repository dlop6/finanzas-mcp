import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createContextCompactor, InMemoryConversationSessionStore, createSessionChatService } from "@/host/context";
import { createDeepSeekClient, DeepSeekClientError } from "@/host/llm";
import { HOST_MCP_LOG_SESSION_ID } from "@/host/mcp-clients/mcp-interaction-log";
import { createChatOrchestrator } from "@/host/orchestration/chat-orchestrator";
import { HostWriteOperationDescriber, TransactionReferenceResolver } from "@/host/confirmation";
import { createFinancialReportDemo, FinancialReportDemoError, startHostMcpRuntime } from "./index";

function displayLogs(title: string, entries: ReturnType<Awaited<ReturnType<typeof startHostMcpRuntime>>["interactionLogs"]["listBySession"]>): void {
  stdout.write(`${title}\n`);
  for (const entry of entries) {
    stdout.write(`${entry.timestamp} ${entry.serverId} ${entry.transport} ${entry.direction} ${entry.method ?? ""} ${String(entry.requestId ?? "")} ${entry.status}${entry.durationMs === undefined ? "" : ` ${entry.durationMs}ms`} ${entry.payload}\n`);
  }
}

async function main(): Promise<void> {
  const runtime = await startHostMcpRuntime();
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const deepSeekClient = createDeepSeekClient();
    const chat = createSessionChatService({
      sessionStore: new InMemoryConversationSessionStore(),
      chatOrchestrator: createChatOrchestrator({ deepSeekClient, toolRegistry: runtime.registry }),
      contextCompactor: createContextCompactor({ deepSeekClient }),
      writeOperationDescriber: new HostWriteOperationDescriber(new TransactionReferenceResolver(runtime.registry)),
    });
    const demo = createFinancialReportDemo({
      sessionChat: chat,
      registry: runtime.registry,
      filesystemClient: runtime.filesystemClient,
      gitClient: runtime.gitClient,
      interactionLogs: runtime.interactionLogs,
      projectRoot: process.cwd(),
      console: { write: (value) => stdout.write(value), read: () => readline.question("> ") },
    });
    const result = await demo.run();
    if (result.status === "completed") {
      stdout.write(`Report created: ${result.reportPath}\nCommit created: ${result.commitMessage}\n`);
    } else {
      stdout.write(`Demo cancelled at ${result.cancelledStep}.\n`);
    }
    displayLogs("HOST MCP logs:", runtime.interactionLogs.listBySession(HOST_MCP_LOG_SESSION_ID));
    displayLogs("Session MCP logs:", runtime.interactionLogs.listBySession(result.sessionId));
  } finally {
    readline.close();
    await runtime.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof FinancialReportDemoError || error instanceof DeepSeekClientError) {
    const http = error instanceof DeepSeekClientError && error.status !== undefined ? ` HTTP ${error.status}` : "";
    console.error(`E2E demo failed: ${error.code}${http}`);
  } else {
    console.error("E2E demo failed.");
  }
  process.exitCode = 1;
});
