import "dotenv/config";

import { DeepSeekClientError, createDeepSeekClient } from "@/host/llm";
import { startFinanceMcpSessionLocal } from "@/host/mcp-clients/finance-mcp-local";
import { registerFinanceMcpTools } from "./finance-mcp-tools";
import { ChatOrchestrationError, createChatOrchestrator } from "./chat-orchestrator";
import { HostMcpToolRegistry } from "./mcp-tool-registry";

async function main(): Promise<void> {
  const financeClient = await startFinanceMcpSessionLocal({ onStderr: () => undefined });

  try {
    const toolRegistry = new HostMcpToolRegistry();
    await registerFinanceMcpTools(toolRegistry, financeClient);
    const result = await createChatOrchestrator({
      deepSeekClient: createDeepSeekClient(),
      toolRegistry,
    }).run({
      systemPrompt: "You are a financial assistant. Use only get_current_balance to answer the user's question.",
      history: [],
      userMessage: "What is my current balance?",
    });

    if (result.status !== "completed" || result.response.toolCalls.length > 0) {
      throw new ChatOrchestrationError("INVALID_MODEL_RESPONSE", "The orchestration smoke did not produce a final response.");
    }

    const usedReadTool = result.turnMessages.some(
      (message) => message.role === "tool" && message.toolCallId.trim().length > 0,
    );
    if (!usedReadTool) {
      throw new ChatOrchestrationError("INVALID_MODEL_RESPONSE", "The orchestration smoke did not execute a read tool.");
    }

    console.log(result.response.content);
    console.log("Orchestration smoke succeeded.");
  } finally {
    await financeClient.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ChatOrchestrationError || error instanceof DeepSeekClientError) {
    const status = error instanceof DeepSeekClientError && error.status !== undefined ? ` (HTTP ${error.status})` : "";
    console.error(`Orchestration smoke failed: ${error.code}${status}`);
  } else {
    console.error("Orchestration smoke failed.");
  }
  process.exitCode = 1;
});
