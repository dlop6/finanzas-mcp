import { Prisma, type PrismaClient } from "@/database/generated/prisma/client";
import { createChatOrchestrator } from "@/host/orchestration/chat-orchestrator";
import { createSessionChatService, type SessionChatService } from "@/host/context/session-chat-service";
import { InMemoryConversationSessionStore } from "@/host/context/conversation-session-store";
import { classifyConfirmationInput } from "@/host/confirmation";
import { registerFinanceMcpTools } from "@/host/orchestration/finance-mcp-tools";
import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";
import { InMemoryMcpInteractionLogStore } from "@/host/mcp-clients/mcp-interaction-log";
import { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
import { StreamableHttpTransportError } from "@/host/mcp-clients/streamable-http-jsonrpc-client";
import {
  FinanceMcpClientConfigurationError,
  loadFinanceMcpClientConfig,
  startFinanceMcpSession,
  type FinanceMcpClientConfig,
} from "@/host/mcp-clients/finance-mcp-client";
import type { McpCallToolResult, McpTool } from "@/shared/mcp";
import { createFinanceToolRegistry } from "@/servers/finance-mcp/composition";
import type { DeepSeekClient, DeepSeekChatMessage, DeepSeekChatResult } from "@/host/llm";

export const REMOTE_MUTATION_DESCRIPTION_PREFIX = "UN-43 remote validation";
export const REMOTE_MUTATION_AMOUNT = "1.00";

export type RemoteFinanceValidationClient = Pick<McpLifecycleClient, "toolsList" | "toolsCall" | "close"> & {
  state?: string;
};

export type RemoteFinanceValidationOutput = (line: string) => void;
export type RemoteFinanceValidationPrompt = (question: string) => Promise<string>;

export class RemoteFinanceValidationError extends Error {
  constructor(
    public readonly code:
      | "REMOTE_MODE_REQUIRED"
      | "CONFIGURATION_ERROR"
      | "CONTRACT_MISMATCH"
      | "REMOTE_STATE_MISMATCH"
      | "REMOTE_READ_FAILED"
      | "CONFIRMATION_REQUIRED"
      | "REMOTE_WRITE_FAILED"
      | "REMOTE_CLEANUP_FAILED"
      | "REMOTE_ERROR_SCENARIO_FAILED"
      | "TRANSPORT_FAILURE",
    public readonly status?: number,
    public readonly resourceId?: number,
    public readonly scenario?: string,
  ) {
    super(`Remote Finance MCP validation failed: ${code}.`);
    this.name = "RemoteFinanceValidationError";
  }
}

export type ProjectionTotals = {
  currentBalance: string;
  confirmedReceivables: string;
  unconfirmedReceivables: string;
  fixedExpenses: string;
  pendingDebts: string;
  safeProjectedBalance: string;
  potentialProjectedBalance: string;
};

export type RemoteFinanceValidationDependencies = {
  config?: FinanceMcpClientConfig;
  client?: RemoteFinanceValidationClient;
  interactionLogs?: InMemoryMcpInteractionLogStore;
  output?: RemoteFinanceValidationOutput;
  prompt?: RemoteFinanceValidationPrompt;
  now?: () => Date;
  createClient?: (config: FinanceMcpClientConfig, logs: InMemoryMcpInteractionLogStore) => Promise<RemoteFinanceValidationClient>;
  sessionChat?: SessionChatService;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function money(value: string, field: string): Prisma.Decimal {
  void field;
  if (!/^\d+\.\d{2}$/.test(value)) throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
  }
}

function requireExact(value: string, expected: string, code: "REMOTE_READ_FAILED" | "REMOTE_STATE_MISMATCH"): void {
  if (value !== expected) throw new RemoteFinanceValidationError(code);
}

export function assertRemoteMode(config: FinanceMcpClientConfig): void {
  if (config.mode !== "remote") throw new RemoteFinanceValidationError("REMOTE_MODE_REQUIRED");
}

export function compareFinanceToolContracts(expected: readonly McpTool[], actual: readonly McpTool[]): void {
  if (actual.length !== expected.length || stableJson(expected) !== stableJson(actual)) {
    throw new RemoteFinanceValidationError("CONTRACT_MISMATCH");
  }
}

export function reconcileProjection(values: ProjectionTotals): true {
  const current = money(values.currentBalance, "currentBalance");
  const confirmed = money(values.confirmedReceivables, "confirmedReceivables");
  const unconfirmed = money(values.unconfirmedReceivables, "unconfirmedReceivables");
  const fixed = money(values.fixedExpenses, "fixedExpenses");
  const debts = money(values.pendingDebts, "pendingDebts");
  const safe = money(values.safeProjectedBalance, "safeProjectedBalance");
  const potential = money(values.potentialProjectedBalance, "potentialProjectedBalance");
  if (!safe.equals(current.plus(confirmed).minus(fixed).minus(debts)) || !potential.equals(safe.plus(unconfirmed))) {
    throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
  }
  return true;
}

function assertProjectionWindow(value: Record<string, unknown>, expectedHorizon: 7 | 30): void {
  if (value.currency !== "GTQ" || value.horizonDays !== expectedHorizon || typeof value.asOfDate !== "string" || typeof value.throughDate !== "string") {
    throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
  }
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(value.asOfDate) || !datePattern.test(value.throughDate)) throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
  const asOf = new Date(`${value.asOfDate}T00:00:00.000Z`);
  const through = new Date(`${value.throughDate}T00:00:00.000Z`);
  if (Number.isNaN(asOf.getTime()) || Number.isNaN(through.getTime()) || asOf.toISOString().slice(0, 10) !== value.asOfDate || through.toISOString().slice(0, 10) !== value.throughDate) throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
  asOf.setUTCDate(asOf.getUTCDate() + expectedHorizon);
  if (asOf.toISOString().slice(0, 10) !== value.throughDate || through.getTime() <= new Date(`${value.asOfDate}T00:00:00.000Z`).getTime()) {
    throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
  }
}

export function sanitizeRemoteFailure(error: unknown): { code: "TRANSPORT_FAILURE" | "REMOTE_READ_FAILED"; status?: number } {
  if (error instanceof StreamableHttpTransportError) {
    return { code: error.code === "HTTP_ERROR" ? "REMOTE_READ_FAILED" : "TRANSPORT_FAILURE", status: error.status };
  }
  if (error instanceof RemoteFinanceValidationError) return { code: error.code === "REMOTE_READ_FAILED" ? error.code : "TRANSPORT_FAILURE", status: error.status };
  return { code: "TRANSPORT_FAILURE" };
}

function expectedFinanceTools(): McpTool[] {
  // The production composition only stores repository references while building tools.
  // No repository operation or database connection occurs until a tool is called.
  return createFinanceToolRegistry({} as PrismaClient).list();
}

function parseToolResult(turnMessages: ReadonlyArray<Pick<DeepSeekChatMessage, "role" | "content">>): McpCallToolResult {
  const message = [...turnMessages].reverse().find((entry) => entry.role === "tool");
  if (!message || typeof message.content !== "string" || message.content.length === 0) throw new RemoteFinanceValidationError("REMOTE_WRITE_FAILED");
  try {
    const parsed = JSON.parse(message.content) as McpCallToolResult;
    if (!parsed || !Array.isArray(parsed.content)) throw new Error();
    return parsed;
  } catch {
    throw new RemoteFinanceValidationError("REMOTE_WRITE_FAILED");
  }
}

type RemoteTransactionSummary = {
  id: number;
  description: string | null;
  accountId?: number;
  categoryId?: number;
  type?: string;
};

async function listRemoteTransactions(client: RemoteFinanceValidationClient): Promise<RemoteTransactionSummary[]> {
  const result = await client.toolsCall("list_transactions", {});
  const transactions = (result.structuredContent as { transactions?: unknown[] } | undefined)?.transactions;
  if (result.isError || !Array.isArray(transactions)) throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
  return transactions.filter((value): value is RemoteTransactionSummary => {
    if (!value || typeof value !== "object") return false;
    const entry = value as Record<string, unknown>;
    return typeof entry.id === "number" && Number.isInteger(entry.id) && (entry.description === null || typeof entry.description === "string");
  });
}

async function recoverOwnedTransactions(
  client: RemoteFinanceValidationClient,
  transactions: readonly RemoteTransactionSummary[],
  prompt: RemoteFinanceValidationPrompt,
): Promise<void> {
  for (const transaction of transactions.filter((value) => value.description?.startsWith(REMOTE_MUTATION_DESCRIPTION_PREFIX))) {
    const answer = await prompt(`La transacción de recuperación ${transaction.id} pertenece a UN-43. Responde "sí" para eliminarla o "no" para detener la recuperación.`);
    if (classifyConfirmationInput(answer) !== "confirm") throw new RemoteFinanceValidationError("REMOTE_CLEANUP_FAILED", undefined, transaction.id);
    const result = await client.toolsCall("delete_transaction", { transactionId: transaction.id });
    if (result.isError) throw new RemoteFinanceValidationError("REMOTE_CLEANUP_FAILED", undefined, transaction.id);
  }
}

function createdTransactionId(result: McpCallToolResult): number {
  const value = result.structuredContent as { transaction?: { id?: unknown } } | undefined;
  if (!value || typeof value.transaction?.id !== "number" || !Number.isInteger(value.transaction.id)) {
    throw new RemoteFinanceValidationError("REMOTE_WRITE_FAILED");
  }
  return value.transaction.id;
}

function decimalEqual(left: string, right: string): boolean {
  return money(left, "left").equals(money(right, "right"));
}

function noopCompactor() {
  return {
    compactIfNeeded: async (input: { conversationSummary: null; messages: readonly unknown[] }) => ({
      compacted: false,
      conversationSummary: input.conversationSummary,
      messages: structuredClone(input.messages),
    }),
  };
}

function mutationDeepSeekClient(
  description: string,
  transactionId: { value?: number },
  reference: { accountId: number; categoryId: number },
  date: string,
): Pick<DeepSeekClient, "sendChat"> {
  let requestNumber = 0;
  return {
    sendChat: async (): Promise<DeepSeekChatResult> => {
      requestNumber += 1;
      if (requestNumber === 1) {
        return { content: null, toolCalls: [{ id: "un43-create", type: "function" as const, function: { name: "record_income", arguments: JSON.stringify({ accountId: reference.accountId, categoryId: reference.categoryId, amount: REMOTE_MUTATION_AMOUNT, date, description }) } }], model: "un43-test", finishReason: "tool_calls" };
      }
      if (requestNumber === 3) {
        return { content: null, toolCalls: [{ id: "un43-delete", type: "function" as const, function: { name: "delete_transaction", arguments: JSON.stringify({ transactionId: transactionId.value }) } }], model: "un43-test", finishReason: "tool_calls" };
      }
      return { content: "Remote validation operation completed.", toolCalls: [], model: "un43-test", finishReason: "stop" };
    },
  };
}

async function confirmPending(
  sessionChat: SessionChatService,
  sessionId: string,
  initialMessage: string,
  prompt: RemoteFinanceValidationPrompt,
  failureCode: "REMOTE_WRITE_FAILED" | "REMOTE_CLEANUP_FAILED",
  resourceId?: number,
): Promise<Extract<Awaited<ReturnType<SessionChatService["sendMessage"]>>, { status: "completed" }>> {
  let message = initialMessage;
  while (true) {
    const answer = await prompt(message);
    const result = await sessionChat.sendMessage(sessionId, answer);
    if (result.status === "completed") return result;
    if (result.status === "cancelled") throw new RemoteFinanceValidationError(failureCode, undefined, resourceId);
    message = result.message;
  }
}

export async function runRemoteFinanceValidation(dependencies: RemoteFinanceValidationDependencies = {}): Promise<void> {
  const output = dependencies.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  const config = dependencies.config;
  if (!config) throw new RemoteFinanceValidationError("CONFIGURATION_ERROR");
  assertRemoteMode(config);
  const logs = dependencies.interactionLogs ?? new InMemoryMcpInteractionLogStore();
  const client = dependencies.client ?? await (dependencies.createClient ?? (async (selectedConfig, interactionLogs) => startFinanceMcpSession({ config: selectedConfig, interactionLogger: interactionLogs })))(config, logs);
  const prompt = dependencies.prompt;
  let createdId: number | undefined;
  let scenario = "contract";
  try {
    const expected = expectedFinanceTools();
    const discovered = (await client.toolsList()).tools;
    if (expected.length !== 24) throw new RemoteFinanceValidationError("CONTRACT_MISMATCH");
    compareFinanceToolContracts(expected, discovered);
    output("contract: passed");

    scenario = "initial balance";
    const balance = await client.toolsCall("get_current_balance");
    if (balance.isError || !balance.structuredContent) throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
    const balanceData = balance.structuredContent as { currency?: string; currentBalance?: string; totalIncome?: string; totalExpenses?: string; accounts?: Array<{ initialBalance?: string; income?: string; expenses?: string; balance: string }> };
    requireExact(balanceData.currency ?? "", "GTQ", "REMOTE_STATE_MISMATCH");
    requireExact(balanceData.currentBalance ?? "", "19475.00", "REMOTE_STATE_MISMATCH");
    money(balanceData.totalIncome ?? "", "totalIncome");
    money(balanceData.totalExpenses ?? "", "totalExpenses");
    if (!balanceData.accounts?.length || !balanceData.accounts.reduce((total, account) => total.plus(money(account.balance, "accountBalance")), new Prisma.Decimal(0)).equals(money(balanceData.currentBalance ?? "", "currentBalance"))) throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
    const accountIncome = balanceData.accounts.reduce((total, account) => total.plus(money(account.income ?? "", "accountIncome")), new Prisma.Decimal(0));
    const accountExpenses = balanceData.accounts.reduce((total, account) => total.plus(money(account.expenses ?? "", "accountExpenses")), new Prisma.Decimal(0));
    const accountDerivedBalance = balanceData.accounts.reduce((total, account) => total.plus(money(account.initialBalance ?? "", "initialBalance")).plus(money(account.income ?? "", "accountIncome")).minus(money(account.expenses ?? "", "accountExpenses")), new Prisma.Decimal(0));
    if (!accountIncome.equals(money(balanceData.totalIncome ?? "", "totalIncome")) || !accountExpenses.equals(money(balanceData.totalExpenses ?? "", "totalExpenses")) || !accountDerivedBalance.equals(money(balanceData.currentBalance ?? "", "currentBalance"))) throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
    let transactionData = await listRemoteTransactions(client);
    const ownedTransactions = transactionData.filter((transaction) => transaction.description?.startsWith(REMOTE_MUTATION_DESCRIPTION_PREFIX));
    if (ownedTransactions.length > 0) {
      scenario = "stale cleanup";
      if (!prompt) throw new RemoteFinanceValidationError("CONFIRMATION_REQUIRED");
      await recoverOwnedTransactions(client, ownedTransactions, prompt);
      transactionData = await listRemoteTransactions(client);
      if (transactionData.some((transaction) => transaction.description?.startsWith(REMOTE_MUTATION_DESCRIPTION_PREFIX))) throw new RemoteFinanceValidationError("REMOTE_CLEANUP_FAILED");
    }
    if (transactionData.length !== 20) throw new RemoteFinanceValidationError("REMOTE_STATE_MISMATCH");
    const incomeReference = transactionData.find((transaction) => transaction.type === "INCOME" && Number.isInteger(transaction.accountId) && Number.isInteger(transaction.categoryId));
    if (!incomeReference || typeof incomeReference.accountId !== "number" || typeof incomeReference.categoryId !== "number") throw new RemoteFinanceValidationError("REMOTE_STATE_MISMATCH");
    output("initial state: passed");

    scenario = "projections";
    const projection7 = await client.toolsCall("project_cash_flow", { horizonDays: 7 });
    const projection30 = await client.toolsCall("project_cash_flow", { horizonDays: 30 });
    const projection7Repeat = await client.toolsCall("project_cash_flow", { horizonDays: 7 });
    const projection30Repeat = await client.toolsCall("project_cash_flow", { horizonDays: 30 });
    if (stableJson(projection7.structuredContent) !== stableJson(projection7Repeat.structuredContent) || stableJson(projection30.structuredContent) !== stableJson(projection30Repeat.structuredContent)) throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
    for (const [projection, horizon] of [[projection7, 7], [projection30, 30]] as const) {
      if (projection.isError || !projection.structuredContent) throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
      assertProjectionWindow(projection.structuredContent as Record<string, unknown>, horizon);
      reconcileProjection(projection.structuredContent as ProjectionTotals);
    }
    output("projections: passed");

    scenario = "viability";
    const viability = await client.toolsCall("evaluate_purchase_viability", { purchaseAmount: REMOTE_MUTATION_AMOUNT, horizonDays: 30 });
    if (viability.isError || !viability.structuredContent) throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
    const viabilityData = viability.structuredContent as Record<string, unknown>;
    if (viabilityData.currency !== "GTQ" || viabilityData.horizonDays !== 30 || typeof viabilityData.asOfDate !== "string" || typeof viabilityData.throughDate !== "string") throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
    const safeAfter = money(String(viabilityData.safeBalanceAfterPurchase), "safeBalanceAfterPurchase");
    const potentialAfter = money(String(viabilityData.potentialBalanceAfterPurchase), "potentialBalanceAfterPurchase");
    const safe = money(String(viabilityData.safeProjectedBalance), "safeProjectedBalance");
    const minimum = money(String(viabilityData.minimumSafetyBalance), "minimumSafetyBalance");
    const maximumCandidate = safe.minus(minimum);
    const maximumSafe = maximumCandidate.lessThan(0) ? new Prisma.Decimal(0) : maximumCandidate;
    const expectedStatus = safeAfter.greaterThanOrEqualTo(minimum)
      ? "VIABLE"
      : potentialAfter.greaterThanOrEqualTo(minimum)
        ? "VIABLE_WITH_RISK"
        : "NOT_VIABLE";
    if (!safeAfter.equals(safe.minus(money(String(viabilityData.purchaseAmount), "purchaseAmount"))) || !potentialAfter.equals(money(String(viabilityData.potentialProjectedBalance), "potentialProjectedBalance").minus(money(String(viabilityData.purchaseAmount), "purchaseAmount"))) || !money(String(viabilityData.maximumSafePurchase), "maximumSafePurchase").equals(maximumSafe) || viabilityData.status !== expectedStatus) throw new RemoteFinanceValidationError("REMOTE_READ_FAILED");
    output("viability: passed");

    scenario = "remote errors";
    const invalid = await client.toolsCall("project_cash_flow", { horizonDays: 14 });
    if (!invalid.isError) throw new RemoteFinanceValidationError("REMOTE_ERROR_SCENARIO_FAILED");
    let unknownPassed = false;
    try { await client.toolsCall("un_43_unknown_finance_tool", {}); } catch { unknownPassed = true; }
    if (!unknownPassed || (await client.toolsCall("get_current_balance")).isError) throw new RemoteFinanceValidationError("REMOTE_ERROR_SCENARIO_FAILED");
    output("errors and recovery: passed");

    scenario = "creation confirmation";
    if (!prompt) throw new RemoteFinanceValidationError("CONFIRMATION_REQUIRED");
    const mutationDate = (dependencies.now ?? (() => new Date()))().toISOString().slice(0, 10);
    const description = `${REMOTE_MUTATION_DESCRIPTION_PREFIX} ${(dependencies.now ?? (() => new Date()))().toISOString()}`;
    const registry = new HostMcpToolRegistry();
    await registerFinanceMcpTools(registry, client);
    const transactionId = { value: undefined as number | undefined };
    const orchestrator = createChatOrchestrator({
      deepSeekClient: mutationDeepSeekClient(description, transactionId, { accountId: incomeReference.accountId, categoryId: incomeReference.categoryId }, mutationDate),
      toolRegistry: registry,
    });
    const sessionChat = dependencies.sessionChat ?? createSessionChatService({
      sessionStore: new InMemoryConversationSessionStore({ idGenerator: () => `un43-${Date.now()}` }),
      chatOrchestrator: orchestrator,
      contextCompactor: noopCompactor() as never,
    });
    const session = sessionChat.createSession({ systemPrompt: "Use only the requested Finance MCP tool." });
    const pendingCreate = await sessionChat.sendMessage(session.sessionId, "Create the controlled validation income.");
    if (pendingCreate.status !== "confirmation_required") throw new RemoteFinanceValidationError("CONFIRMATION_REQUIRED");
    const completedCreate = await confirmPending(sessionChat, session.sessionId, pendingCreate.message, prompt, "REMOTE_WRITE_FAILED");
    scenario = "creation verification";
    const createResult = parseToolResult(completedCreate.turnMessages);
    createdId = createdTransactionId(createResult);
    transactionId.value = createdId;
    const persisted = await client.toolsCall("list_transactions", {});
    const persistedData = persisted.structuredContent as { transactions?: Array<{ id: number; description: string | null }> } | undefined;
    if (persisted.isError || persistedData?.transactions?.length !== 21 || !persistedData.transactions.some((transaction) => transaction.id === createdId && transaction.description === description)) throw new RemoteFinanceValidationError("REMOTE_WRITE_FAILED", undefined, createdId);
    const afterCreateBalance = await client.toolsCall("get_current_balance");
    const afterCreateData = afterCreateBalance.structuredContent as { currentBalance?: string };
    if (!decimalEqual(afterCreateData.currentBalance ?? "", "19476.00")) throw new RemoteFinanceValidationError("REMOTE_WRITE_FAILED", undefined, createdId);
    output("confirmed creation: passed");

    scenario = "cleanup confirmation";
    const pendingDelete = await sessionChat.sendMessage(session.sessionId, "Prepare the cleanup operation.");
    if (pendingDelete.status !== "confirmation_required") throw new RemoteFinanceValidationError("CONFIRMATION_REQUIRED", undefined, createdId);
    const completedDelete = await confirmPending(sessionChat, session.sessionId, pendingDelete.message, prompt, "REMOTE_CLEANUP_FAILED", createdId);
    scenario = "cleanup verification";
    const deleteResult = parseToolResult(completedDelete.turnMessages);
    if (deleteResult.isError) throw new RemoteFinanceValidationError("REMOTE_CLEANUP_FAILED", undefined, createdId);
    createdId = undefined;
    const finalBalance = await client.toolsCall("get_current_balance");
    const finalTransactions = await client.toolsCall("list_transactions", {});
    const finalData = finalTransactions.structuredContent as { transactions?: Array<{ id: number }> } | undefined;
    if (finalTransactions.isError || finalData?.transactions?.length !== 20 || (finalBalance.structuredContent as { currentBalance?: string })?.currentBalance !== "19475.00") throw new RemoteFinanceValidationError("REMOTE_CLEANUP_FAILED");
    output("confirmed cleanup: passed");
    if (dependencies.interactionLogs && !dependencies.interactionLogs.listBySession("HOST").some((entry) => entry.transport === "STREAMABLE_HTTP")) throw new RemoteFinanceValidationError("TRANSPORT_FAILURE");
  } catch (error) {
    const mutationStarted = scenario === "creation confirmation" || scenario === "creation verification" || scenario === "cleanup confirmation" || scenario === "cleanup verification";
    if (mutationStarted && prompt) {
      try {
        const ownedTransactions = (await listRemoteTransactions(client)).filter((transaction) => transaction.description?.startsWith(REMOTE_MUTATION_DESCRIPTION_PREFIX));
        if (ownedTransactions.length > 0) {
          await recoverOwnedTransactions(client, ownedTransactions, prompt);
          if ((await listRemoteTransactions(client)).some((transaction) => transaction.description?.startsWith(REMOTE_MUTATION_DESCRIPTION_PREFIX))) {
            throw new RemoteFinanceValidationError("REMOTE_CLEANUP_FAILED", undefined, createdId);
          }
          createdId = undefined;
        }
      } catch (cleanupError) {
        const cleanup = cleanupError instanceof RemoteFinanceValidationError
          ? cleanupError
          : new RemoteFinanceValidationError("REMOTE_CLEANUP_FAILED", undefined, createdId);
        throw new RemoteFinanceValidationError("REMOTE_CLEANUP_FAILED", cleanup.status, cleanup.resourceId ?? createdId, scenario);
      }
    }
    if (error instanceof RemoteFinanceValidationError) {
      if (error.scenario) throw error;
      throw new RemoteFinanceValidationError(error.code, error.status, error.resourceId, scenario);
    }
    const sanitized = sanitizeRemoteFailure(error);
    throw new RemoteFinanceValidationError(sanitized.code === "REMOTE_READ_FAILED" ? sanitized.code : "TRANSPORT_FAILURE", sanitized.status, createdId, scenario);
  } finally {
    await client.close();
  }
}

export async function loadAndRunRemoteFinanceValidation(dependencies: Omit<RemoteFinanceValidationDependencies, "config"> = {}): Promise<void> {
  let config: FinanceMcpClientConfig;
  try {
    config = loadFinanceMcpClientConfig();
  } catch (error) {
    if (error instanceof FinanceMcpClientConfigurationError) throw new RemoteFinanceValidationError("CONFIGURATION_ERROR");
    throw error;
  }
  await runRemoteFinanceValidation({ ...dependencies, config });
}
