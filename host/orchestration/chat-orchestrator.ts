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
    }
  | {
      status: "confirmation_required";
      pendingOperation: PendingWriteOperation;
      turnMessages: DeepSeekChatMessage[];
    };

export type ChatOrchestrationInput = {
  sessionId: string;
  systemPrompt: string;
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
      const userMessage = requireText(input.userMessage, "userMessage");
      const history = input.history.map(cloneMessage);
      const firstMessages: DeepSeekChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userMessage },
      ];
      const turnMessages: DeepSeekChatMessage[] = [{ role: "user", content: userMessage }];
      const firstResponse = await options.deepSeekClient.sendChat(firstMessages, options.toolRegistry.toDeepSeekTools());
      const firstAssistantMessage = assistantMessage(firstResponse);
      turnMessages.push(firstAssistantMessage);

      if (firstResponse.toolCalls.length === 0) {
        ensureFinalContent(firstResponse);
        return { status: "completed", response: firstResponse, turnMessages: structuredClone(turnMessages) };
      }

      const prepared = prepareToolCalls(options.toolRegistry, firstResponse.toolCalls);
      const writes = prepared.filter((call) => call.tool.isWriteOperation);
      if (writes.length > 0) {
        if (prepared.length !== 1 || writes.length !== 1) {
          throw new ChatOrchestrationError("UNSUPPORTED_WRITE_BATCH", "Write tool calls must be requested one at a time.");
        }

        const write = writes[0];
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

      const toolMessages: DeepSeekChatMessage[] = [];
      for (const preparedCall of prepared) {
        let result: McpCallToolResult;
        try {
          result = await preparedCall.tool.client.toolsCall(preparedCall.tool.definition.name, preparedCall.arguments, { sessionId });
        } catch {
          result = safeMcpFailure();
        }
        toolMessages.push({ role: "tool", toolCallId: preparedCall.call.id, content: serializeToolResult(result) });
      }

      const finalResponse = await options.deepSeekClient.sendChat([
        ...firstMessages,
        firstAssistantMessage,
        ...toolMessages,
      ]);
      ensureFinalContent(finalResponse);
      turnMessages.push(...toolMessages, assistantMessage(finalResponse));

      return { status: "completed", response: finalResponse, turnMessages: structuredClone(turnMessages) };
    },

    async completeConfirmedWrite(input) {
      const sessionId = requireText(input.sessionId, "sessionId");
      const systemPrompt = requireText(input.systemPrompt, "systemPrompt");
      const history = input.history.map(cloneMessage);
      const pendingTurnMessages = input.pendingTurnMessages.map(cloneMessage);
      const tool = validatePendingWrite(options.toolRegistry, input.pendingOperation, pendingTurnMessages);
      let toolResult: McpCallToolResult;
      try {
        toolResult = await tool.client.toolsCall(input.pendingOperation.toolName, structuredClone(input.pendingOperation.arguments), { sessionId });
      } catch {
        toolResult = safeMcpFailure();
      }

      const toolMessage: DeepSeekChatMessage = {
        role: "tool",
        toolCallId: input.pendingOperation.toolCallId,
        content: serializeToolResult(toolResult),
      };
      let finalResponse: DeepSeekChatResult;
      try {
        finalResponse = await options.deepSeekClient.sendChat([
          { role: "system", content: systemPrompt },
          ...history,
          ...pendingTurnMessages,
          toolMessage,
        ]);
      } catch {
        throw new ChatOrchestrationError("CONFIRMED_WRITE_RESPONSE_FAILED", "The confirmed write was processed but no final response was generated.");
      }
      ensureFinalContent(finalResponse);
      return {
        status: "completed",
        response: finalResponse,
        turnMessages: structuredClone([...pendingTurnMessages, toolMessage, assistantMessage(finalResponse)]),
      };
    },
  };
}
