import {
  createContextCompactor,
  createSessionChatService,
  InMemoryConversationSessionStore,
  type SessionChatService,
} from "@/host/context";
import { createDeepSeekClient, type DeepSeekClient } from "@/host/llm";
import { startFilesystemMcpSessionLocal } from "@/host/mcp-clients/filesystem-mcp-local";
import { startFinanceMcpSession, type StartFinanceMcpSessionOptions } from "@/host/mcp-clients/finance-mcp-client";
import { startGitMcpSessionLocal } from "@/host/mcp-clients/git-mcp-local";
import { InMemoryMcpInteractionLogStore, type McpInteractionLogReader, type McpInteractionLogWriter } from "@/host/mcp-clients/mcp-interaction-log";
import type { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
import { createChatOrchestrator } from "@/host/orchestration/chat-orchestrator";
import { HostWriteOperationDescriber, TransactionReferenceResolver } from "@/host/confirmation";
import { FILESYSTEM_MCP_SERVER_ID, registerFilesystemMcpTools } from "@/host/orchestration/filesystem-mcp-tools";
import { registerFinanceMcpTools } from "@/host/orchestration/finance-mcp-tools";
import { GIT_MCP_SERVER_ID, registerGitMcpTools } from "@/host/orchestration/git-mcp-tools";
import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";
import { createWebFinancialDashboardService, type WebFinancialDashboardService } from "./financial-dashboard";

function guatemalaDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function createWebHostSystemPrompt(now: Date = new Date()): string {
  return [
  "Eres un asistente de gestión financiera para una pequeña empresa.",
  "Responde siempre en español.",
  "Usa Markdown solo cuando mejore la claridad: párrafos breves, listas o tablas si aportan valor.",
  "No emitas HTML, imágenes remotas ni envuelvas toda la respuesta en un bloque de código.",
  "Responde preguntas generales directamente y usa las herramientas registradas solo cuando necesites datos o una acción externa.",
  "Finance MCP es la autoridad para cálculos y datos financieros: no inventes saldos, movimientos ni resultados.",
  "Antes de preparar record_income, record_expense, record_transactions_batch o record_mixed_transactions_batch, consulta get_transaction_reference_data para usar cuentas y categorías reales por nombre.",
  "Para una venta, consulta list_products y get_transaction_reference_data. Propón la categoría Ventas únicamente si existe. Usa quote_sale antes de record_sale. Una venta registra un ingreso y salidas de inventario juntas, nunca como escrituras separadas. El precio de catálogo se usa salvo que la persona indique un precio aplicado distinto.",
  "Una cotización válida del historial puede utilizarse en el siguiente turno. Si la persona acepta sus detalles, solicita record_sale con los recordArguments exactos de la última cotización para preparar la tarjeta. La aceptación textual no ejecuta la venta. La ejecución requiere el botón Confirmar operación. Si cambian los datos o ya no está disponible la cotización estructurada, consulta quote_sale nuevamente. No pidas otra confirmación textual cuando ya puedas preparar la tarjeta.",
  "Nunca pidas accountId ni categoryId. Pregunta por nombres cuando falten o sean ambiguos. Si se pide cualquier categoría, propone Otros ingresos u Otros gastos solo si aparece en las referencias compatibles.",
  `La fecha actual en America/Guatemala es ${guatemalaDate(now)}. Si el usuario omite el año, propón este año y muestra la fecha completa antes de confirmar.`,
  "Aclara montos o monedas ambiguos y no conviertas monedas. El sistema usa GTQ. Para varios movimientos de un solo tipo usa record_transactions_batch. Para ingresos y gastos combinados usa record_mixed_transactions_batch. Cuentas o categorías diferentes no impiden formar un lote. Asigna montos y fechas por orden solo si las cantidades coinciden y pide aclaración si no coinciden. Solo propone descripciones si el usuario delega explícitamente su redacción.",
  "No afirmes que una escritura se realizó antes de la confirmación explícita del Host.",
  ].join(" ");
}

export const WEB_HOST_SYSTEM_PROMPT = createWebHostSystemPrompt();

export type WebFinanceRuntime = {
  registry: HostMcpToolRegistry;
  interactionLogs: McpInteractionLogReader;
  financeClient: McpLifecycleClient;
  dashboard: WebFinancialDashboardService;
  close(): Promise<void>;
};

export type WebHostRuntime = WebFinanceRuntime & { sessionChat: SessionChatService };
export type WebFinanceRuntimeFactory = () => Promise<WebFinanceRuntime>;
export type WebHostRuntimeFactory = () => Promise<WebHostRuntime>;

export type CreateWebFinanceRuntimeOptions = {
  startFinance?: (options: StartFinanceMcpSessionOptions) => Promise<McpLifecycleClient>;
  interactionLogger?: McpInteractionLogReader & McpInteractionLogWriter;
};

export class WebHostRuntimeError extends Error {
  constructor(
    public readonly code: "START_FAILED" | "INVALID_CATALOG",
    message: string,
    public readonly stage: "finance" | "chat" | "discovery",
  ) {
    super(message);
    this.name = "WebHostRuntimeError";
  }
}

export async function createWebFinanceRuntime(options: CreateWebFinanceRuntimeOptions = {}): Promise<WebFinanceRuntime> {
  const logs = options.interactionLogger ?? new InMemoryMcpInteractionLogStore();
  let financeClient: McpLifecycleClient | undefined;
  try {
    financeClient = await (options.startFinance ?? startFinanceMcpSession)({ interactionLogger: logs, onStderr: () => undefined });
    const registry = new HostMcpToolRegistry();
    await registerFinanceMcpTools(registry, financeClient);
    const tools = registry.list();
    if (tools.length !== 30 || tools.filter((tool) => tool.isWriteOperation).length !== 18) {
      throw new WebHostRuntimeError("INVALID_CATALOG", "The Finance MCP catalog is incomplete.", "finance");
    }
    const startedFinanceClient = financeClient;
    let closed = false;
    return {
      registry,
      interactionLogs: logs,
      financeClient,
      dashboard: createWebFinancialDashboardService({ registry }),
      async close() {
        if (closed) return;
        closed = true;
        await startedFinanceClient.close();
      },
    };
  } catch (error) {
    await financeClient?.close().catch(() => undefined);
    if (error instanceof WebHostRuntimeError) throw error;
    throw new WebHostRuntimeError("START_FAILED", "Could not start the Finance MCP runtime.", "finance");
  }
}

type ChatExtensionOptions = {
  createDeepSeek?: () => DeepSeekClient;
  startFilesystem?: (options: { interactionLogger: McpInteractionLogWriter; onStderr: () => void }) => Promise<McpLifecycleClient>;
  startGit?: (options: { interactionLogger: McpInteractionLogWriter; onStderr: () => void }) => Promise<McpLifecycleClient>;
};

export async function createWebHostRuntime(options: ChatExtensionOptions & {
  createFinanceRuntime?: () => Promise<WebFinanceRuntime>;
} = {}): Promise<WebHostRuntime> {
  const financeRuntime = await (options.createFinanceRuntime ?? createWebFinanceRuntime)();
  try {
    return await extendWebFinanceRuntime(financeRuntime, options);
  } catch (error) {
    await financeRuntime.close().catch(() => undefined);
    throw error;
  }
}

async function extendWebFinanceRuntime(financeRuntime: WebFinanceRuntime, options: ChatExtensionOptions): Promise<WebHostRuntime> {
  const deepSeekClient = (options.createDeepSeek ?? createDeepSeekClient)();
  const contextCompactor = createContextCompactor({ deepSeekClient });
  const logger = financeRuntime.interactionLogs as unknown as McpInteractionLogWriter;
  const started: McpLifecycleClient[] = [];
  try {
    const filesystemClient = await (options.startFilesystem ?? startFilesystemMcpSessionLocal)({ interactionLogger: logger, onStderr: () => undefined });
    started.push(filesystemClient);
    const gitClient = await (options.startGit ?? startGitMcpSessionLocal)({ interactionLogger: logger, onStderr: () => undefined });
    started.push(gitClient);
    await registerFilesystemMcpTools(financeRuntime.registry, filesystemClient);
    await registerGitMcpTools(financeRuntime.registry, gitClient);
    const tools = financeRuntime.registry.list();
    if (tools.length !== 56 || tools.filter((tool) => tool.isWriteOperation).length !== 27) {
      throw new WebHostRuntimeError("INVALID_CATALOG", "The Host MCP catalog is incomplete.", "discovery");
    }
    const chatOrchestrator = createChatOrchestrator({ deepSeekClient, toolRegistry: financeRuntime.registry });
    const sessionChat = createSessionChatService({
      sessionStore: new InMemoryConversationSessionStore(),
      chatOrchestrator,
      contextCompactor,
      writeOperationDescriber: new HostWriteOperationDescriber(new TransactionReferenceResolver(financeRuntime.registry)),
    });
    let closed = false;
    return {
      ...financeRuntime,
      sessionChat,
      async close() {
        if (closed) return;
        closed = true;
        await Promise.allSettled([gitClient.close(), filesystemClient.close(), financeRuntime.close()]);
      },
    };
  } catch (error) {
    financeRuntime.registry.unregisterServer(GIT_MCP_SERVER_ID);
    financeRuntime.registry.unregisterServer(FILESYSTEM_MCP_SERVER_ID);
    await Promise.allSettled(started.reverse().map((client) => client.close()));
    if (error instanceof WebHostRuntimeError) throw error;
    throw new WebHostRuntimeError("START_FAILED", "Could not extend the Web Host runtime.", "chat");
  }
}

/** Compatibility manager used by callers that own a complete runtime factory. */
export class WebHostRuntimeManager {
  private runtimePromise: Promise<WebHostRuntime> | undefined;
  private runtime: WebHostRuntime | undefined;

  constructor(private readonly factory: WebHostRuntimeFactory = createWebHostRuntime) {}

  get(): Promise<WebHostRuntime> {
    if (this.runtimePromise) return this.runtimePromise;
    const promise = this.factory().then((runtime) => {
      this.runtime = runtime;
      return runtime;
    }).catch((error: unknown) => {
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
    await runtime?.close();
  }
}

class WebRuntimeManager {
  private financePromise: Promise<WebFinanceRuntime> | undefined;
  private financeRuntime: WebFinanceRuntime | undefined;
  private hostPromise: Promise<WebHostRuntime> | undefined;
  private hostRuntime: WebHostRuntime | undefined;

  getFinance(): Promise<WebFinanceRuntime> {
    if (this.hostRuntime) return Promise.resolve(this.hostRuntime);
    if (this.financePromise) return this.financePromise;
    // Dashboard requests share this promise and never require the chat-only DeepSeek, Filesystem, or Git capabilities.
    const promise = createWebFinanceRuntime().then((runtime) => {
      this.financeRuntime = runtime;
      return runtime;
    }).catch((error: unknown) => {
      if (this.financePromise === promise) this.financePromise = undefined;
      throw error;
    });
    this.financePromise = promise;
    return promise;
  }

  getHost(): Promise<WebHostRuntime> {
    if (this.hostPromise) return this.hostPromise;
    // Chat extends the already-running Finance foundation, preserving one registry and interaction log store per process.
    const promise = this.getFinance().then((financeRuntime) => extendWebFinanceRuntime(financeRuntime, {})).then((runtime) => {
      this.hostRuntime = runtime;
      this.financeRuntime = runtime;
      return runtime;
    }).catch((error: unknown) => {
      if (this.hostPromise === promise) this.hostPromise = undefined;
      throw error;
    });
    this.hostPromise = promise;
    return promise;
  }

  async close(): Promise<void> {
    const runtime = this.hostRuntime ?? this.financeRuntime;
    this.hostRuntime = undefined;
    this.hostPromise = undefined;
    this.financeRuntime = undefined;
    this.financePromise = undefined;
    await runtime?.close();
  }
}

declare global {
  var financeMcpWebRuntimeManager: WebRuntimeManager | undefined;
  var financeMcpWebHostShutdownHooksInstalled: boolean | undefined;
}

function getGlobalManager(): WebRuntimeManager {
  if (!globalThis.financeMcpWebRuntimeManager) globalThis.financeMcpWebRuntimeManager = new WebRuntimeManager();
  return globalThis.financeMcpWebRuntimeManager;
}

function reportRuntimeFailure(error: unknown): never {
  const value = error as { code?: unknown; stage?: unknown } | undefined;
  const code = value?.code === "START_FAILED" || value?.code === "INVALID_CATALOG" ? value.code : "UNKNOWN";
  const stage = ["finance", "chat", "discovery"].includes(String(value?.stage)) ? String(value?.stage) : "configuration";
  console.error(`[web-host] initialization failed: ${code}:${stage}`);
  throw error;
}

export function getWebFinanceRuntime(): Promise<WebFinanceRuntime> {
  return getGlobalManager().getFinance().catch(reportRuntimeFailure);
}

export function getWebHostRuntime(): Promise<WebHostRuntime> {
  return getGlobalManager().getHost().catch(reportRuntimeFailure);
}

export async function closeWebHostRuntime(): Promise<void> {
  await getGlobalManager().close();
}

export function installWebHostShutdownHooks(): void {
  if (globalThis.financeMcpWebHostShutdownHooksInstalled) return;
  globalThis.financeMcpWebHostShutdownHooksInstalled = true;
  const close = () => { void closeWebHostRuntime(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
