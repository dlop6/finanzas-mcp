import {
  createContextCompactor,
  createSessionChatService,
  InMemoryConversationSessionStore,
  type SessionChatService,
} from "@/host/context";
import { createDeepSeekClient, type DeepSeekClient } from "@/host/llm";
import { startHostMcpRuntime, type HostMcpRuntime } from "@/host/demo/local-mcp-runtime";
import { createChatOrchestrator } from "@/host/orchestration/chat-orchestrator";
import type { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";
import type { McpInteractionLogReader } from "@/host/mcp-clients/mcp-interaction-log";

export const WEB_HOST_SYSTEM_PROMPT = [
  "Eres un asistente de gestión financiera para una pequeña empresa.",
  "Responde siempre en español.",
  "Responde preguntas generales directamente y usa las herramientas registradas solo cuando necesites datos o una acción externa.",
  "Finance MCP es la autoridad para cálculos y datos financieros: no inventes saldos, movimientos ni resultados.",
  "No afirmes que una escritura se realizó antes de la confirmación explícita del Host.",
].join(" ");

export type WebHostRuntime = {
  sessionChat: SessionChatService;
  registry: HostMcpToolRegistry;
  interactionLogs: McpInteractionLogReader;
  close(): Promise<void>;
};

export type WebHostRuntimeFactory = () => Promise<WebHostRuntime>;

export async function createWebHostRuntime(options: {
  createDeepSeek?: () => DeepSeekClient;
  startMcpRuntime?: () => Promise<HostMcpRuntime>;
} = {}): Promise<WebHostRuntime> {
  const deepSeekClient = (options.createDeepSeek ?? createDeepSeekClient)();
  const contextCompactor = createContextCompactor({ deepSeekClient });
  const mcpRuntime = await (options.startMcpRuntime ?? startHostMcpRuntime)();

  try {
    const chatOrchestrator = createChatOrchestrator({
      deepSeekClient,
      toolRegistry: mcpRuntime.registry,
    });
    const sessionChat = createSessionChatService({
      sessionStore: new InMemoryConversationSessionStore(),
      chatOrchestrator,
      contextCompactor,
    });
    return {
      sessionChat,
      registry: mcpRuntime.registry,
      interactionLogs: mcpRuntime.interactionLogs,
      close: () => mcpRuntime.close(),
    };
  } catch (error) {
    await mcpRuntime.close();
    throw error;
  }
}

export class WebHostRuntimeManager {
  private runtimePromise: Promise<WebHostRuntime> | undefined;
  private runtime: WebHostRuntime | undefined;

  constructor(private readonly factory: WebHostRuntimeFactory = createWebHostRuntime) {}

  get(): Promise<WebHostRuntime> {
    if (this.runtimePromise) return this.runtimePromise;

    const promise = this.factory()
      .then((runtime) => {
        this.runtime = runtime;
        return runtime;
      })
      .catch((error: unknown) => {
        if (this.runtimePromise === promise) this.runtimePromise = undefined;
        throw error;
      });
    this.runtimePromise = promise;
    return promise;
  }

  async close(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = undefined;
    this.runtimePromise = undefined;
    if (runtime) await runtime.close();
  }
}

declare global {
  var financeMcpWebHostRuntimeManager: WebHostRuntimeManager | undefined;
  var financeMcpWebHostShutdownHooksInstalled: boolean | undefined;
}

function getGlobalManager(): WebHostRuntimeManager {
  if (!globalThis.financeMcpWebHostRuntimeManager) {
    globalThis.financeMcpWebHostRuntimeManager = new WebHostRuntimeManager();
  }
  return globalThis.financeMcpWebHostRuntimeManager;
}

export function getWebHostRuntime(): Promise<WebHostRuntime> {
  return getGlobalManager().get().catch((error: unknown) => {
    const code = safeRuntimeFailureCode(error);
    console.error(`[web-host] initialization failed: ${code}`);
    throw error;
  });
}

function safeRuntimeFailureCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "UNKNOWN";
  const value = error as { code?: unknown; stage?: unknown };
  const code = typeof value.code === "string"
    && ["CONFIGURATION_ERROR", "START_FAILED", "INVALID_CATALOG"].includes(value.code)
    ? value.code
    : "UNKNOWN";
  const stage = typeof value.stage === "string"
    && ["finance", "filesystem", "git", "discovery"].includes(value.stage)
    ? value.stage
    : "configuration";
  return `${code}:${stage}`;
}

export async function closeWebHostRuntime(): Promise<void> {
  await getGlobalManager().close();
}

export function installWebHostShutdownHooks(): void {
  if (globalThis.financeMcpWebHostShutdownHooksInstalled) return;
  globalThis.financeMcpWebHostShutdownHooksInstalled = true;
  const close = () => {
    void closeWebHostRuntime();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
