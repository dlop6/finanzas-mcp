export type DeepSeekChatRole = "system" | "user" | "assistant" | "tool";

export type DeepSeekToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type DeepSeekToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type DeepSeekChatMessage =
  | {
      role: "system" | "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string | null;
      toolCalls?: readonly DeepSeekToolCall[];
    }
  | {
      role: "tool";
      toolCallId: string;
      content: string;
    };

export type DeepSeekUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
};

export type DeepSeekChatResult = {
  content: string | null;
  toolCalls: DeepSeekToolCall[];
  usage?: DeepSeekUsage;
  model: string;
  finishReason: string | null;
};

export type DeepSeekConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type DeepSeekEnvironment = Record<string, string | undefined>;
export type DeepSeekFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const DEEPSEEK_TIMEOUT_MS = 30_000;

export type DeepSeekErrorCode =
  | "CONFIGURATION_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE";

export class DeepSeekClientError extends Error {
  readonly code: DeepSeekErrorCode;
  readonly status?: number;

  constructor(code: DeepSeekErrorCode, message: string, status?: number) {
    super(message);
    this.name = "DeepSeekClientError";
    this.code = code;
    this.status = status;
  }
}

function requiredEnvironmentValue(environment: DeepSeekEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new DeepSeekClientError("CONFIGURATION_ERROR", `Missing ${name}.`);
  }
  return value;
}

export function loadDeepSeekConfig(environment: DeepSeekEnvironment = process.env): DeepSeekConfig {
  const apiKey = requiredEnvironmentValue(environment, "DEEPSEEK_API_KEY");
  const baseUrl = requiredEnvironmentValue(environment, "DEEPSEEK_BASE_URL");
  const model = requiredEnvironmentValue(environment, "DEEPSEEK_MODEL");

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new DeepSeekClientError("CONFIGURATION_ERROR", "DEEPSEEK_BASE_URL must be a valid HTTPS URL.");
  }

  if (parsedBaseUrl.protocol !== "https:") {
    throw new DeepSeekClientError("CONFIGURATION_ERROR", "DEEPSEEK_BASE_URL must use HTTPS.");
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
  };
}

export type DeepSeekClientOptions = {
  config?: DeepSeekConfig;
  environment?: DeepSeekEnvironment;
  fetchImpl?: DeepSeekFetch;
  timeoutMs?: number;
};

export type DeepSeekClient = {
  sendChat(
    messages: readonly DeepSeekChatMessage[],
    tools?: readonly DeepSeekToolDefinition[],
    options?: DeepSeekChatOptions,
  ): Promise<DeepSeekChatResult>;
};

export type DeepSeekChatOptions = {
  responseFormat?: "text" | "json_object";
};

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidToolCall(value: unknown): value is DeepSeekToolCall {
  if (!isRecord(value) || value.type !== "function" || !isNonEmptyText(value.id) || !isRecord(value.function)) {
    return false;
  }

  return isNonEmptyText(value.function.name) && typeof value.function.arguments === "string";
}

function validateMessages(messages: readonly DeepSeekChatMessage[]): void {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new DeepSeekClientError("INVALID_RESPONSE", "At least one chat message is required.");
  }

  for (const message of messages) {
    if (!message || !["system", "user", "assistant", "tool"].includes(message.role)) {
      throw new DeepSeekClientError("INVALID_RESPONSE", "Chat messages have an invalid role.");
    }

    if (message.role === "tool") {
      if (!isNonEmptyText(message.toolCallId) || !isNonEmptyText(message.content)) {
        throw new DeepSeekClientError("INVALID_RESPONSE", "Tool messages must contain a call ID and text.");
      }
      continue;
    }

    if (message.role === "assistant") {
      const hasContent = isNonEmptyText(message.content);
      const hasToolCalls = message.toolCalls !== undefined && message.toolCalls.length > 0;
      if ((!hasContent && !hasToolCalls) || (message.toolCalls !== undefined && !message.toolCalls.every(isValidToolCall))) {
        throw new DeepSeekClientError("INVALID_RESPONSE", "Assistant messages must contain text or valid tool calls.");
      }
      continue;
    }

    if (!isNonEmptyText(message.content)) {
      throw new DeepSeekClientError("INVALID_RESPONSE", "Chat messages must contain text.");
    }
  }
}

function serializeMessage(message: DeepSeekChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }

  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.toolCalls?.length ? { tool_calls: structuredClone(message.toolCalls) } : {}),
    };
  }

  return { role: message.role, content: message.content };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseUsage(value: unknown): DeepSeekUsage | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned invalid usage metadata.");
  }

  if (
    !isNonNegativeInteger(value.prompt_tokens) ||
    !isNonNegativeInteger(value.completion_tokens) ||
    !isNonNegativeInteger(value.total_tokens)
  ) {
    throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned invalid usage metadata.");
  }

  const usage: DeepSeekUsage = {
    promptTokens: value.prompt_tokens,
    completionTokens: value.completion_tokens,
    totalTokens: value.total_tokens,
  };

  if (value.prompt_cache_hit_tokens !== undefined) {
    if (!isNonNegativeInteger(value.prompt_cache_hit_tokens)) {
      throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned invalid usage metadata.");
    }
    usage.promptCacheHitTokens = value.prompt_cache_hit_tokens;
  }
  if (value.prompt_cache_miss_tokens !== undefined) {
    if (!isNonNegativeInteger(value.prompt_cache_miss_tokens)) {
      throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned invalid usage metadata.");
    }
    usage.promptCacheMissTokens = value.prompt_cache_miss_tokens;
  }

  return usage;
}

function parseToolCalls(value: unknown): DeepSeekToolCall[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned invalid tool calls.");
  }

  return value.map((toolCall) => {
    if (!isRecord(toolCall) || toolCall.type !== "function" || typeof toolCall.id !== "string") {
      throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned invalid tool calls.");
    }
    const functionCall = toolCall.function;
    if (
      !isRecord(functionCall) ||
      typeof functionCall.name !== "string" ||
      typeof functionCall.arguments !== "string"
    ) {
      throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned invalid tool calls.");
    }
    return {
      id: toolCall.id,
      type: "function",
      function: {
        name: functionCall.name,
        arguments: functionCall.arguments,
      },
    };
  });
}

function parseChatResponse(value: unknown): DeepSeekChatResult {
  if (!isRecord(value) || typeof value.model !== "string" || !Array.isArray(value.choices)) {
    throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned an invalid response.");
  }

  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned an invalid response.");
  }

  const content = choice.message.content;
  if (content !== null && typeof content !== "string") {
    throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned an invalid response.");
  }

  const finishReason = choice.finish_reason;
  if (finishReason !== null && typeof finishReason !== "string") {
    throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned an invalid response.");
  }

  return {
    content,
    toolCalls: parseToolCalls(choice.message.tool_calls),
    usage: parseUsage(value.usage),
    model: value.model,
    finishReason,
  };
}

export function createDeepSeekClient(options: DeepSeekClientOptions = {}): DeepSeekClient {
  const config = options.config ?? loadDeepSeekConfig(options.environment);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEEPSEEK_TIMEOUT_MS;
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new DeepSeekClientError("CONFIGURATION_ERROR", "DeepSeek timeout must be a positive integer.");
  }

  return {
    async sendChat(messages, tools, chatOptions = {}) {
      validateMessages(messages);
      if (chatOptions.responseFormat !== undefined && chatOptions.responseFormat !== "text" && chatOptions.responseFormat !== "json_object") {
        throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek response format is invalid.");
      }
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const requestBody: {
          model: string;
          messages: Record<string, unknown>[];
          stream: false;
          thinking: { type: "disabled" };
          tools?: readonly DeepSeekToolDefinition[];
          response_format?: { type: "json_object" };
        } = {
          model: config.model,
          messages: messages.map(serializeMessage),
          stream: false,
          thinking: { type: "disabled" },
        };

        if (tools?.length) {
          requestBody.tools = structuredClone(tools);
        }
        if (chatOptions.responseFormat === "json_object") {
          requestBody.response_format = { type: "json_object" };
        }

        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new DeepSeekClientError("HTTP_ERROR", `DeepSeek request failed with status ${response.status}.`, response.status);
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new DeepSeekClientError("INVALID_RESPONSE", "DeepSeek returned invalid JSON.");
        }
        return parseChatResponse(payload);
      } catch (error) {
        if (error instanceof DeepSeekClientError) {
          throw error;
        }
        if (timedOut || (error instanceof DOMException && error.name === "AbortError")) {
          throw new DeepSeekClientError("TIMEOUT", "DeepSeek request timed out.");
        }
        throw new DeepSeekClientError("NETWORK_ERROR", "DeepSeek request could not be completed.");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
