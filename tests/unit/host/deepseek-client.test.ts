import { describe, expect, it, vi } from "vitest";
import {
  DeepSeekClientError,
  createDeepSeekClient,
  loadDeepSeekConfig,
} from "@/host/llm/deepseek-client";
import type { DeepSeekConfig, DeepSeekFetch } from "@/host/llm/deepseek-client";
import { sendGeneralChat } from "@/host/llm/general-chat";

const apiKey = "fake-deepseek-key";
const config: DeepSeekConfig = {
  apiKey,
  baseUrl: "https://api.deepseek.com/",
  model: "test-model",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: "test-model",
    choices: [
      {
        finish_reason: "stop",
        message: { content: "Hello from DeepSeek", role: "assistant" },
      },
    ],
    usage: {
      prompt_tokens: 3,
      completion_tokens: 4,
      total_tokens: 7,
    },
    ...overrides,
  };
}

function fetchReturning(response: Response): DeepSeekFetch {
  return vi.fn(async () => response) as unknown as DeepSeekFetch;
}

describe("DeepSeek configuration", () => {
  it("loads and trims the required values without hardcoding the model", () => {
    expect(
      loadDeepSeekConfig({
        DEEPSEEK_API_KEY: ` ${apiKey} `,
        DEEPSEEK_BASE_URL: "https://example.test/",
        DEEPSEEK_MODEL: " custom-model ",
      }),
    ).toEqual({ apiKey, baseUrl: "https://example.test", model: "custom-model" });
  });

  it("rejects missing or unsafe configuration without exposing values", () => {
    for (const name of ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL"]) {
      expect(() =>
        loadDeepSeekConfig({
          DEEPSEEK_API_KEY: name === "DEEPSEEK_API_KEY" ? undefined : apiKey,
          DEEPSEEK_BASE_URL: name === "DEEPSEEK_BASE_URL" ? undefined : "https://example.test",
          DEEPSEEK_MODEL: name === "DEEPSEEK_MODEL" ? undefined : "model",
        }),
      ).toThrow(DeepSeekClientError);
    }

    expect(() =>
      loadDeepSeekConfig({
        DEEPSEEK_API_KEY: apiKey,
        DEEPSEEK_BASE_URL: "http://example.test",
        DEEPSEEK_MODEL: "model",
      }),
    ).toThrow("HTTPS");
  });
});

describe("DeepSeek client", () => {
  it("sends the configured model, messages, and non-streaming request", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<DeepSeekFetch>) => {
      void args;
      return jsonResponse(validResponse());
    });
    const client = createDeepSeekClient({ config, fetchImpl: fetchMock });
    const messages = [
      { role: "system" as const, content: "Be concise." },
      { role: "user" as const, content: "Hello" },
    ];

    await expect(client.sendChat(messages)).resolves.toMatchObject({
      content: "Hello from DeepSeek",
      model: "test-model",
      toolCalls: [],
      usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0];
    expect(input).toBe("https://api.deepseek.com/chat/completions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "test-model",
      messages,
      stream: false,
      thinking: { type: "disabled" },
    });
  });

  it("sends public tools without mutating them or adding tool-choice metadata", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<DeepSeekFetch>) => {
      void args;
      return jsonResponse(validResponse());
    });
    const client = createDeepSeekClient({ config, fetchImpl: fetchMock });
    const tools = [{
      type: "function" as const,
      function: {
        name: "get_balance",
        description: "Get the current balance.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    }];

    await client.sendChat([{ role: "user", content: "What is my balance?" }], tools);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.tools).toEqual(tools);
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("strict");
    expect(tools[0].function.parameters).toEqual({ type: "object", additionalProperties: false, properties: {} });
  });

  it("returns tool calls and optional usage without executing them", async () => {
    const client = createDeepSeekClient({
      config,
      fetchImpl: fetchReturning(
        jsonResponse(
          validResponse({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: { name: "lookup", arguments: '{"value":1}' },
                    },
                  ],
                },
              },
            ],
            usage: undefined,
          }),
        ),
      ),
    });

    await expect(client.sendChat([{ role: "user", content: "Use a tool." }])).resolves.toMatchObject({
      content: null,
      toolCalls: [{ id: "call-1", function: { name: "lookup", arguments: '{"value":1}' } }],
      usage: undefined,
    });
  });

  it("serializes assistant tool calls and tool results using the provider wire format", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<DeepSeekFetch>) => {
      void args;
      return jsonResponse(validResponse());
    });
    const client = createDeepSeekClient({ config, fetchImpl: fetchMock });
    const messages = [
      { role: "user" as const, content: "What is my balance?" },
      {
        role: "assistant" as const,
        content: null,
        toolCalls: [{ id: "call-1", type: "function" as const, function: { name: "read_balance", arguments: "{}" } }],
      },
      { role: "tool" as const, toolCallId: "call-1", content: '{"amount":"19475.00"}' },
    ];

    await client.sendChat(messages);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      messages: [
        { role: "user", content: "What is my balance?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name: "read_balance", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "call-1", content: '{"amount":"19475.00"}' },
      ],
    });
  });

  it.each([400, 401, 402, 429, 500, 503])(
    "maps HTTP %s errors without exposing the key or response body",
    async (status) => {
    const secretBody = `provider detail ${apiKey}`;
    const client = createDeepSeekClient({
      config,
      fetchImpl: fetchReturning(new Response(secretBody, { status })),
    });

    const error = await client.sendChat([{ role: "user", content: "Hello" }]).catch((value) => value);
    expect(error).toMatchObject({ code: "HTTP_ERROR", status });
    expect(error).toBeInstanceOf(DeepSeekClientError);
    expect(error.message).not.toContain(apiKey);
    expect(error.message).not.toContain(secretBody);
    },
  );

  it("handles malformed responses and network failures safely", async () => {
    const malformed = createDeepSeekClient({
      config,
      fetchImpl: fetchReturning(jsonResponse({ choices: [] })),
    });
    await expect(malformed.sendChat([{ role: "user", content: "Hello" }])).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });

    const network = createDeepSeekClient({
      config,
      fetchImpl: vi.fn(async () => {
        throw new Error(`network detail ${apiKey}`);
      }) as unknown as DeepSeekFetch,
    });
    const error = await network.sendChat([{ role: "user", content: "Hello" }]).catch((value) => value);
    expect(error).toMatchObject({ code: "NETWORK_ERROR" });
    expect(error.message).not.toContain(apiKey);
  });

  it("aborts a request after the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
      );
      const client = createDeepSeekClient({ config, fetchImpl: fetchMock, timeoutMs: 10 });
      const pending = client.sendChat([{ role: "user", content: "Wait" }]);
      const rejection = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
      await vi.advanceTimersByTimeAsync(10);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects empty messages before making a request", async () => {
    const fetchMock = vi.fn();
    const client = createDeepSeekClient({ config, fetchImpl: fetchMock as unknown as DeepSeekFetch });
    await expect(client.sendChat([])).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("general chat composition", () => {
  it("sends system prompt, history, and current message in order", async () => {
    const sendChat = vi.fn(async (messages) => ({
      content: messages.at(-1)?.content ?? null,
      toolCalls: [],
      model: "test-model",
      finishReason: "stop",
    }));
    const history = [
      { role: "user" as const, content: "Previous question" },
      { role: "assistant" as const, content: "Previous answer" },
    ];

    await expect(
      sendGeneralChat(
        { sendChat },
        { systemPrompt: "You are helpful.", history, userMessage: "Current question" },
      ),
    ).resolves.toMatchObject({ content: "Current question" });
    expect(sendChat).toHaveBeenCalledWith([
      { role: "system", content: "You are helpful." },
      ...history,
      { role: "user", content: "Current question" },
    ]);
    expect(history).toEqual([
      { role: "user", content: "Previous question" },
      { role: "assistant", content: "Previous answer" },
    ]);
  });

  it("rejects empty general-chat inputs without calling the client", async () => {
    const sendChat = vi.fn();
    await expect(
      sendGeneralChat(
        { sendChat },
        { systemPrompt: " ", history: [], userMessage: "Hello" },
      ),
    ).rejects.toThrow("systemPrompt");
    expect(sendChat).not.toHaveBeenCalled();
  });
});
