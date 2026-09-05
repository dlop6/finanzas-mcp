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

const BATCH_TOOL_NAME = "record_transactions_batch";

/** Converts equivalent model-issued transaction calls into one stored, confirmable batch without executing any write. */
function normalizeTransactionWriteBatch(toolRegistry: HostMcpToolRegistry, prepared: readonly PreparedToolCall[]): PreparedToolCall | null {
  if (prepared.length < 2 || prepared.length > 25) return null;
  const firstName = prepared[0]?.tool.definition.name;
  if ((firstName !== "record_income" && firstName !== "record_expense") || prepared.some((call) => call.tool.definition.name !== firstName || call.tool.serverId !== "finance-mcp")) {
    return null;
  }
  let tool: RegisteredMcpTool;
  try {
    tool = toolRegistry.resolve(BATCH_TOOL_NAME);
  } catch {
    return null;
  }
  if (!tool.isWriteOperation || tool.serverId !== "finance-mcp") return null;
  const arguments_ = {
    type: firstName === "record_income" ? "INCOME" : "EXPENSE",
    transactions: prepared.map((call) => structuredClone(call.arguments)),
  };
  const call: DeepSeekToolCall = {
    id: `batch-${prepared[0].call.id}`,
    type: "function",
    function: { name: BATCH_TOOL_NAME, arguments: JSON.stringify(arguments_) },
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
        const response = fallbackResponse(input.pendingOperation.toolName === BATCH_TOOL_NAME
          ? "No se registró ningún movimiento del lote."
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
        finalResponse = fallbackResponse(input.pendingOperation.toolName === BATCH_TOOL_NAME ? "Se registraron correctamente los movimientos del lote." : "La operación se ejecutó correctamente.");
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
