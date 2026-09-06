import { isDeepStrictEqual } from "node:util";
import type {
  DeepSeekChatMessage,
  DeepSeekChatResult,
  DeepSeekClient,
  DeepSeekToolCall,
} from "@/host/llm";
import {
  HostMcpToolRegistry,
  HostToolRegistryError,
  type RegisteredMcpTool,
} from "./mcp-tool-registry";
import type { McpCallToolResult } from "@/shared/mcp";

export type ChatOrchestrationErrorCode =
  | "INVALID_INPUT"
  | "INVALID_TOOL_CALL"
  | "INVALID_TOOL_ARGUMENTS"
  | "UNKNOWN_TOOL"
  | "UNSUPPORTED_WRITE_BATCH"
  | "SALE_QUOTE_REQUIRED"
  | "TOOL_ROUND_LIMIT"
  | "INVALID_MODEL_RESPONSE"
  | "PENDING_OPERATION_MISMATCH"
  | "CONFIRMED_WRITE_RESPONSE_FAILED";

export class ChatOrchestrationError extends Error {
  constructor(
    public readonly code: ChatOrchestrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChatOrchestrationError";
  }
}

export type PendingWriteOperation = {
  toolCallId: string;
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
};

export type OrchestratedChatResult =
  | {
      status: "completed";
      response: DeepSeekChatResult;
      turnMessages: DeepSeekChatMessage[];
      writeOutcome?: "succeeded" | "rejected" | "unknown";
    }
  | {
      status: "confirmation_required";
      pendingOperation: PendingWriteOperation;
      turnMessages: DeepSeekChatMessage[];
    };

export type ChatOrchestrationInput = {
  sessionId: string;
  systemPrompt: string;
  contextSummary?: string;
  history: readonly DeepSeekChatMessage[];
  userMessage: string;
};

export type ChatOrchestrator = {
  run(input: ChatOrchestrationInput): Promise<OrchestratedChatResult>;
  completeConfirmedWrite(input: ConfirmedWriteInput): Promise<Extract<OrchestratedChatResult, { status: "completed" }>>;
};

export type ConfirmedWriteInput = {
  sessionId: string;
  systemPrompt: string;
  contextSummary?: string;
  history: readonly DeepSeekChatMessage[];
  pendingOperation: PendingWriteOperation;
  pendingTurnMessages: readonly DeepSeekChatMessage[];
};

export type CreateChatOrchestratorOptions = {
  deepSeekClient: Pick<DeepSeekClient, "sendChat">;
  toolRegistry: HostMcpToolRegistry;
};

type PreparedToolCall = {
  call: DeepSeekToolCall;
  tool: RegisteredMcpTool;
  arguments: Record<string, unknown>;
};

const HOMOGENEOUS_BATCH_TOOL_NAME = "record_transactions_batch";
const MIXED_BATCH_TOOL_NAME = "record_mixed_transactions_batch";
const SALE_TOOL_NAME = "record_sale";
type TransactionType = "INCOME" | "EXPENSE";
type ProposedTransaction = { type: TransactionType; accountId: number; categoryId: number; amount: string; date: string; description?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function proposedTransaction(value: unknown, type: TransactionType): ProposedTransaction | null {
  if (!isRecord(value) || !Number.isInteger(value.accountId) || (value.accountId as number) < 1 || !Number.isInteger(value.categoryId) || (value.categoryId as number) < 1 || typeof value.amount !== "string" || typeof value.date !== "string") return null;
  if (value.description !== undefined && typeof value.description !== "string") return null;
  return {
    type,
    accountId: value.accountId as number,
    categoryId: value.categoryId as number,
    amount: value.amount,
    date: value.date,
    ...(value.description === undefined ? {} : { description: value.description }),
  };
}

function flattenTransactionWrite(call: PreparedToolCall): ProposedTransaction[] | null {
  if (call.tool.serverId !== "finance-mcp") return null;
  if (call.tool.definition.name === "record_income") {
    const transaction = proposedTransaction(call.arguments, "INCOME");
    return transaction ? [transaction] : null;
  }
  if (call.tool.definition.name === "record_expense") {
    const transaction = proposedTransaction(call.arguments, "EXPENSE");
    return transaction ? [transaction] : null;
  }
  if (call.tool.definition.name !== HOMOGENEOUS_BATCH_TOOL_NAME || !Array.isArray(call.arguments.transactions) || (call.arguments.type !== "INCOME" && call.arguments.type !== "EXPENSE")) return null;
  const batchType: TransactionType = call.arguments.type === "INCOME" ? "INCOME" : "EXPENSE";
  const transactions = call.arguments.transactions.map((value) => proposedTransaction(value, batchType));
  return transactions.every((transaction): transaction is ProposedTransaction => transaction !== null) ? transactions : null;
}

/** Converts related model-issued transaction writes into one stored confirmation without executing any write. */
function normalizeTransactionWriteBatch(toolRegistry: HostMcpToolRegistry, prepared: readonly PreparedToolCall[]): PreparedToolCall | null {
  if (prepared.length < 2 || prepared.some((call) => !call.tool.isWriteOperation)) return null;
  const groups = prepared.map(flattenTransactionWrite);
  if (groups.some((group) => group === null)) return null;
  const transactions = groups.flatMap((group) => group ?? []);
  if (transactions.length < 2 || transactions.length > 25) return null;
  const mixed = new Set(transactions.map((transaction) => transaction.type)).size === 2;
  const toolName = mixed ? MIXED_BATCH_TOOL_NAME : HOMOGENEOUS_BATCH_TOOL_NAME;
  let tool: RegisteredMcpTool;
  try {
    tool = toolRegistry.resolve(toolName);
  } catch {
    return null;
  }
  if (!tool.isWriteOperation || tool.serverId !== "finance-mcp") return null;
  const arguments_ = mixed
    ? { transactions: structuredClone(transactions) }
    : {
        type: transactions[0]!.type,
        transactions: transactions.map((transaction) =>
          structuredClone({
            accountId: transaction.accountId,
            categoryId: transaction.categoryId,
            amount: transaction.amount,
            date: transaction.date,
            ...(transaction.description === undefined ? {} : { description: transaction.description }),
          }),
        ),
      };
  const call: DeepSeekToolCall = {
    id: `batch-${prepared[0]!.call.id}`,
    type: "function",
    function: { name: toolName, arguments: JSON.stringify(arguments_) },
  };
  return { call, tool, arguments: arguments_ };
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ChatOrchestrationError("INVALID_INPUT", `${field} must contain text.`);
  }
  return value;
}

function cloneMessage(message: DeepSeekChatMessage): DeepSeekChatMessage {
  return structuredClone(message);
}

function assistantMessage(result: DeepSeekChatResult): DeepSeekChatMessage {
  return {
    role: "assistant",
    content: result.content,
    ...(result.toolCalls.length ? { toolCalls: structuredClone(result.toolCalls) } : {}),
  };
}

function ensureFinalContent(result: DeepSeekChatResult): void {
  if (result.toolCalls.length) {
    throw new ChatOrchestrationError("TOOL_ROUND_LIMIT", "The model requested another tool round.");
  }
  if (typeof result.content !== "string" || result.content.trim().length === 0) {
    throw new ChatOrchestrationError("INVALID_MODEL_RESPONSE", "The model returned no final response.");
  }
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(argumentsJson);
  } catch {
    throw new ChatOrchestrationError("INVALID_TOOL_ARGUMENTS", "The model returned invalid tool arguments.");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ChatOrchestrationError("INVALID_TOOL_ARGUMENTS", "The model returned invalid tool arguments.");
  }

  return structuredClone(value) as Record<string, unknown>;
}

function prepareToolCalls(toolRegistry: HostMcpToolRegistry, toolCalls: readonly DeepSeekToolCall[]): PreparedToolCall[] {
  const ids = new Set<string>();
  const prepared: PreparedToolCall[] = [];

  for (const call of toolCalls) {
    if (!call.id.trim() || !call.function.name.trim() || ids.has(call.id)) {
      throw new ChatOrchestrationError("INVALID_TOOL_CALL", "The model returned an invalid tool call.");
    }
    ids.add(call.id);

    let tool: RegisteredMcpTool;
    try {
      tool = toolRegistry.resolve(call.function.name);
    } catch (error) {
      if (error instanceof HostToolRegistryError && error.code === "UNKNOWN_TOOL") {
        throw new ChatOrchestrationError("UNKNOWN_TOOL", "The model requested an unknown MCP tool.");
      }
      throw error;
    }

    prepared.push({ call: structuredClone(call), tool, arguments: parseToolArguments(call.function.arguments) });
  }

  return prepared;
}

function safeMcpFailure(): McpCallToolResult {
  return {
    content: [{ type: "text", text: "MCP tool execution failed." }],
    isError: true,
    structuredContent: { error: { type: "MCP_ERROR" } },
  };
}

function serializeToolResult(result: McpCallToolResult): string {
  return JSON.stringify(result);
}

function fallbackResponse(content: string): DeepSeekChatResult {
  return { content, toolCalls: [], model: "host", finishReason: "stop" };
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Session history retains quotes across turns; only the latest correlated quote can prepare a sale. */
function hasMatchingSaleQuote(registry: HostMcpToolRegistry, messages: readonly DeepSeekChatMessage[], arguments_: Record<string, unknown>): boolean {
  let quoteCallId: string | undefined;
  let recordArguments: Record<string, unknown> | undefined;
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        let tool: RegisteredMcpTool;
        try { tool = registry.resolve(call.function.name); } catch { continue; }
        if (tool.isWriteOperation || call.function.name === "quote_sale") {
          quoteCallId = undefined;
          recordArguments = undefined;
        }
        if (call.function.name === "quote_sale" && tool.serverId === "finance-mcp" && !tool.isWriteOperation) {
          quoteCallId = call.id;
        }
      }
    }
    if (message.role !== "tool" || !quoteCallId || message.toolCallId !== quoteCallId) continue;
    quoteCallId = undefined;
    try {
      const result: unknown = JSON.parse(message.content);
      if (isRecord(result) && result.isError !== true && isRecord(result.structuredContent) && isRecord(result.structuredContent.recordArguments)) {
        recordArguments = structuredClone(result.structuredContent.recordArguments);
      }
    } catch { recordArguments = undefined; }
  }
  return recordArguments !== undefined && isDeepStrictEqual(recordArguments, arguments_);
}

function validatePendingWrite(
  toolRegistry: HostMcpToolRegistry,
  pendingOperation: PendingWriteOperation,
  pendingTurnMessages: readonly DeepSeekChatMessage[],
): RegisteredMcpTool {
  const assistant = pendingTurnMessages.at(-1);
  if (!assistant || assistant.role !== "assistant" || !assistant.toolCalls || assistant.toolCalls.length !== 1) {
    throw new ChatOrchestrationError("PENDING_OPERATION_MISMATCH", "The pending write operation is invalid.");
  }

  const call = assistant.toolCalls[0];
  let parsedArguments: Record<string, unknown>;
  try {
    parsedArguments = parseToolArguments(call.function.arguments);
  } catch {
    throw new ChatOrchestrationError("PENDING_OPERATION_MISMATCH", "The pending write operation is invalid.");
  }

  if (
    call.id !== pendingOperation.toolCallId ||
    call.function.name !== pendingOperation.toolName ||
    !sameJsonValue(parsedArguments, pendingOperation.arguments)
  ) {
    throw new ChatOrchestrationError("PENDING_OPERATION_MISMATCH", "The pending write operation is invalid.");
  }

  let tool: RegisteredMcpTool;
  try {
    tool = toolRegistry.resolve(pendingOperation.toolName);
  } catch {
    throw new ChatOrchestrationError("PENDING_OPERATION_MISMATCH", "The pending write operation is invalid.");
  }
  if (!tool.isWriteOperation || tool.serverId !== pendingOperation.serverId) {
    throw new ChatOrchestrationError("PENDING_OPERATION_MISMATCH", "The pending write operation is invalid.");
  }

  return tool;
}

export function createChatOrchestrator(options: CreateChatOrchestratorOptions): ChatOrchestrator {
  return {
    async run(input) {
      const sessionId = requireText(input.sessionId, "sessionId");
      const systemPrompt = requireText(input.systemPrompt, "systemPrompt");
      const contextSummary = input.contextSummary === undefined ? undefined : requireText(input.contextSummary, "contextSummary");
      const userMessage = requireText(input.userMessage, "userMessage");
      const history = input.history.map(cloneMessage);
      const firstMessages: DeepSeekChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...(contextSummary ? [{ role: "system" as const, content: contextSummary }] : []),
        ...history,
        { role: "user", content: userMessage },
      ];
      const turnMessages: DeepSeekChatMessage[] = [{ role: "user", content: userMessage }];
      let response = await options.deepSeekClient.sendChat(firstMessages, options.toolRegistry.toDeepSeekTools());

      // Reference reads may precede one proposed write, but the conversation never gets an unbounded tool loop.
      for (let round = 1; round <= 2; round += 1) {
        const responseMessage = assistantMessage(response);
        turnMessages.push(responseMessage);

        if (response.toolCalls.length === 0) {
          ensureFinalContent(response);
          return { status: "completed", response, turnMessages: structuredClone(turnMessages) };
        }

        const prepared = prepareToolCalls(options.toolRegistry, response.toolCalls);
        const writes = prepared.filter((call) => call.tool.isWriteOperation);
        if (writes.length > 0) {
          const normalized = writes.length === prepared.length ? normalizeTransactionWriteBatch(options.toolRegistry, prepared) : null;
          if (prepared.length !== 1 && !normalized) {
            throw new ChatOrchestrationError("UNSUPPORTED_WRITE_BATCH", "Write tool calls must be requested one at a time.");
          }

          const write = normalized ?? writes[0];
          if (write.tool.definition.name === SALE_TOOL_NAME && !hasMatchingSaleQuote(options.toolRegistry, [...history, ...turnMessages.slice(0, -1)], write.arguments)) {
            throw new ChatOrchestrationError("SALE_QUOTE_REQUIRED", "A sale must be quoted before confirmation.");
          }
          if (normalized) {
            turnMessages[turnMessages.length - 1] = {
              role: "assistant",
              content: response.content,
              toolCalls: [structuredClone(normalized.call)],
            };
          }
          return {
            status: "confirmation_required",
            pendingOperation: {
              toolCallId: write.call.id,
              serverId: write.tool.serverId,
              toolName: write.tool.definition.name,
              arguments: structuredClone(write.arguments),
            },
            turnMessages: structuredClone(turnMessages),
          };
        }

        for (const preparedCall of prepared) {
          let result: McpCallToolResult;
          try {
            result = await preparedCall.tool.client.toolsCall(preparedCall.tool.definition.name, preparedCall.arguments, { sessionId });
          } catch {
            result = safeMcpFailure();
          }
          turnMessages.push({ role: "tool", toolCallId: preparedCall.call.id, content: serializeToolResult(result) });
        }

        response = await options.deepSeekClient.sendChat(
          [...firstMessages, ...turnMessages],
          round === 1 ? options.toolRegistry.toDeepSeekTools() : undefined,
        );
      }

      ensureFinalContent(response);
      turnMessages.push(assistantMessage(response));
      return { status: "completed", response, turnMessages: structuredClone(turnMessages) };
    },

    async completeConfirmedWrite(input) {
      const sessionId = requireText(input.sessionId, "sessionId");
      const systemPrompt = requireText(input.systemPrompt, "systemPrompt");
      const contextSummary = input.contextSummary === undefined ? undefined : requireText(input.contextSummary, "contextSummary");
      const history = input.history.map(cloneMessage);
      const pendingTurnMessages = input.pendingTurnMessages.map(cloneMessage);
      const tool = validatePendingWrite(options.toolRegistry, input.pendingOperation, pendingTurnMessages);
      let toolResult: McpCallToolResult;
      try {
        toolResult = await tool.client.toolsCall(input.pendingOperation.toolName, structuredClone(input.pendingOperation.arguments), { sessionId });
      } catch {
        const response = fallbackResponse("No fue posible confirmar si la operación se ejecutó. Verifica los movimientos antes de volver a intentarlo.");
        return {
          status: "completed",
          response,
          writeOutcome: "unknown",
          turnMessages: structuredClone([...pendingTurnMessages, { role: "assistant", content: response.content }]),
        };
      }

      const toolMessage: DeepSeekChatMessage = {
        role: "tool",
        toolCallId: input.pendingOperation.toolCallId,
        content: serializeToolResult(toolResult),
      };
      if (toolResult.isError) {
        const response = fallbackResponse([HOMOGENEOUS_BATCH_TOOL_NAME, MIXED_BATCH_TOOL_NAME].includes(input.pendingOperation.toolName)
          ? "No se registró ningún movimiento del lote."
          : input.pendingOperation.toolName === SALE_TOOL_NAME
            ? "No se registró la venta. No se modificó el inventario ni el ingreso."
          : "La operación fue rechazada por Finance MCP. No se completó el cambio solicitado.");
        return {
          status: "completed",
          response,
          writeOutcome: "rejected",
          turnMessages: structuredClone([...pendingTurnMessages, toolMessage, { role: "assistant", content: response.content }]),
        };
      }
      let finalResponse: DeepSeekChatResult;
      try {
        finalResponse = await options.deepSeekClient.sendChat([
          { role: "system", content: systemPrompt },
          ...(contextSummary ? [{ role: "system" as const, content: contextSummary }] : []),
          ...history,
          ...pendingTurnMessages,
          toolMessage,
        ]);
      } catch {
        finalResponse = fallbackResponse([HOMOGENEOUS_BATCH_TOOL_NAME, MIXED_BATCH_TOOL_NAME].includes(input.pendingOperation.toolName) ? "Se registraron correctamente los movimientos del lote." : input.pendingOperation.toolName === SALE_TOOL_NAME ? "Se registró correctamente la venta." : "La operación se ejecutó correctamente.");
      }
      ensureFinalContent(finalResponse);
      return {
        status: "completed",
        response: finalResponse,
        writeOutcome: "succeeded",
        turnMessages: structuredClone([...pendingTurnMessages, toolMessage, assistantMessage(finalResponse)]),
      };
    },
  };
}
