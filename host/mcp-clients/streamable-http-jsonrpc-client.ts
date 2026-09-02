import {
  isJsonRpcErrorResponse,
  isJsonRpcSuccessResponse,
  JsonRpcRequestIdGenerator,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  validateJsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcParams,
  type JsonRpcRequest,
} from "@/shared/jsonrpc";
import { MCP_PROTOCOL_VERSION } from "@/shared/mcp";
import {
  HOST_MCP_LOG_SESSION_ID,
  sanitizeJsonRpcPayload,
  systemMcpInteractionLogClock,
  type McpInteractionLogClock,
  type McpInteractionLogEntry,
  type McpInteractionLogWriter,
} from "./mcp-interaction-log";
import { JsonRpcRemoteError, type McpJsonRpcTransport, type McpRequestContext } from "./mcp-jsonrpc-transport";

export type StreamableHttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type StreamableHttpTransportErrorCode =
  | "INVALID_STATE"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "PROTOCOL_ERROR"
  | "CLOSED";

export class StreamableHttpTransportError extends Error {
  constructor(public readonly code: StreamableHttpTransportErrorCode, message: string, public readonly status?: number) {
    super(message);
    this.name = "StreamableHttpTransportError";
  }
}

export type StreamableHttpJsonRpcClientOptions = {
  endpoint: URL;
  fetchImpl?: StreamableHttpFetch;
  timeoutMs?: number;
  serverId?: string;
  interactionLogger?: McpInteractionLogWriter;
  logClock?: McpInteractionLogClock;
};

type ClientState = "idle" | "running" | "closing" | "closed" | "failed";

const DEFAULT_TIMEOUT_MS = 60_000;

function headers(sessionId?: string): Headers {
  const result = new Headers({
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  });
  if (sessionId !== undefined) {
    result.set("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
    result.set("MCP-Session-Id", sessionId);
  }
  return result;
}

function validSessionId(value: string | null): value is string {
  return value !== null && /^[\x21-\x7e]+$/.test(value);
}

export class StreamableHttpJsonRpcClient implements McpJsonRpcTransport {
  private readonly idGenerator = new JsonRpcRequestIdGenerator();
  private readonly fetchImpl: StreamableHttpFetch;
  private readonly timeoutMs: number;
  private readonly serverId: string;
  private readonly interactionLogger: McpInteractionLogWriter | undefined;
  private readonly logClock: McpInteractionLogClock;
  private state: ClientState = "idle";
  private mcpSessionId: string | undefined;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly options: StreamableHttpJsonRpcClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.serverId = options.serverId ?? "finance-mcp";
    this.interactionLogger = options.interactionLogger;
    this.logClock = options.logClock ?? systemMcpInteractionLogClock;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new StreamableHttpTransportError("INVALID_STATE", "MCP HTTP timeout must be a positive integer.");
    }
  }

  async start(): Promise<void> {
    if (this.state === "running") return;
    if (this.state !== "idle") {
      throw new StreamableHttpTransportError("INVALID_STATE", "MCP HTTP client cannot start in its current state.");
    }
    this.state = "running";
  }

  async request<Result>(method: string, params?: JsonRpcParams, context?: McpRequestContext): Promise<Result> {
    this.assertRunning();
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.idGenerator.next(),
      method,
      ...(params === undefined ? {} : { params }),
    };
    if (!validateJsonRpcMessage(request).ok) {
      throw new StreamableHttpTransportError("PROTOCOL_ERROR", "Could not create a valid JSON-RPC request.");
    }

    const payload = serializeJsonRpcMessage(request);
    const sessionId = this.sessionIdFor(context);
    const startedAt = this.logClock.monotonicNow();
    this.appendLog({ sessionId, direction: "HOST_TO_MCP", messageType: "request", method, requestId: request.id, payload, status: "SENT" });

    try {
      const response = await this.fetchWithTimeout({ method: "POST", headers: headers(this.headersSessionFor(method)), body: payload });
      if (response.status !== 200) {
        throw new StreamableHttpTransportError("HTTP_ERROR", "MCP HTTP request failed.", response.status);
      }
      const raw = await response.text();
      const parsed = parseJsonRpcMessage(raw);
      if (!parsed.ok || (!isJsonRpcSuccessResponse(parsed.message) && !isJsonRpcErrorResponse(parsed.message)) || parsed.message.id !== request.id) {
        this.appendLog({ sessionId, direction: "MCP_TO_HOST", messageType: "error", method, requestId: request.id, payload: raw, status: "PROTOCOL_ERROR", durationMs: this.durationSince(startedAt) });
        throw new StreamableHttpTransportError("PROTOCOL_ERROR", "MCP server returned an invalid JSON-RPC response.");
      }
      if (method === "initialize") {
        // The transport owns this server-issued value so it cannot reach lifecycle callers, logs, or Web DTOs.
        const issuedSessionId = response.headers.get("mcp-session-id");
        if (!validSessionId(issuedSessionId)) {
          this.appendLog({ sessionId, direction: "MCP_TO_HOST", messageType: "error", method, requestId: request.id, payload: raw, status: "PROTOCOL_ERROR", durationMs: this.durationSince(startedAt) });
          throw new StreamableHttpTransportError("PROTOCOL_ERROR", "MCP server did not establish a valid session.");
        }
        this.mcpSessionId = issuedSessionId;
      }
      if (isJsonRpcSuccessResponse(parsed.message)) {
        this.appendLog({ sessionId, direction: "MCP_TO_HOST", messageType: "response", method, requestId: request.id, payload: raw, status: "SUCCEEDED", durationMs: this.durationSince(startedAt) });
        return parsed.message.result as Result;
      }
      this.appendLog({ sessionId, direction: "MCP_TO_HOST", messageType: "error", method, requestId: request.id, payload: raw, status: "REMOTE_ERROR", durationMs: this.durationSince(startedAt) });
      throw new JsonRpcRemoteError(parsed.message.id, parsed.message.error.code, parsed.message.error.message, parsed.message.error.data);
    } catch (error) {
      if (error instanceof JsonRpcRemoteError) throw error;
      const normalized = this.normalizeError(error);
      this.appendLog({ sessionId, direction: "HOST_TO_MCP", messageType: "error", method, requestId: request.id, payload, status: normalized.code === "PROTOCOL_ERROR" ? "PROTOCOL_ERROR" : "TRANSPORT_ERROR", durationMs: this.durationSince(startedAt) });
      if (normalized.code === "PROTOCOL_ERROR") this.state = "failed";
      throw normalized;
    }
  }

  async notify(method: string, params?: JsonRpcParams, context?: McpRequestContext): Promise<void> {
    this.assertRunning();
    if (!this.mcpSessionId) {
      throw new StreamableHttpTransportError("INVALID_STATE", "MCP HTTP session has not been initialized.");
    }
    const notification: JsonRpcNotification = { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) };
    if (!validateJsonRpcMessage(notification).ok) {
      throw new StreamableHttpTransportError("PROTOCOL_ERROR", "Could not create a valid JSON-RPC notification.");
    }
    const payload = serializeJsonRpcMessage(notification);
    const sessionId = this.sessionIdFor(context);
    const startedAt = this.logClock.monotonicNow();
    this.appendLog({ sessionId, direction: "HOST_TO_MCP", messageType: "notification", method, payload, status: "SENT" });
    try {
      const response = await this.fetchWithTimeout({ method: "POST", headers: headers(this.mcpSessionId), body: payload });
      if (response.status !== 202) throw new StreamableHttpTransportError("HTTP_ERROR", "MCP HTTP notification failed.", response.status);
    } catch (error) {
      const normalized = this.normalizeError(error);
      this.appendLog({ sessionId, direction: "HOST_TO_MCP", messageType: "error", method, payload, status: normalized.code === "PROTOCOL_ERROR" ? "PROTOCOL_ERROR" : "TRANSPORT_ERROR", durationMs: this.durationSince(startedAt) });
      throw normalized;
    }
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    if (this.closePromise) return this.closePromise;
    this.state = "closing";
    this.closePromise = this.closeSession();
    return this.closePromise;
  }

  private async closeSession(): Promise<void> {
    const sessionId = this.mcpSessionId;
    this.mcpSessionId = undefined;
    try {
      if (sessionId) {
        const response = await this.fetchWithTimeout({ method: "DELETE", headers: new Headers({ "MCP-Protocol-Version": MCP_PROTOCOL_VERSION, "MCP-Session-Id": sessionId }) });
        if (response.status !== 204) throw new StreamableHttpTransportError("HTTP_ERROR", "MCP HTTP session close failed.", response.status);
      }
    } finally {
      this.state = "closed";
    }
  }

  private async fetchWithTimeout(init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(this.options.endpoint, { ...init, signal: controller.signal });
    } catch {
      if (controller.signal.aborted) throw new StreamableHttpTransportError("TIMEOUT", "MCP HTTP request timed out.");
      throw new StreamableHttpTransportError("NETWORK_ERROR", "MCP HTTP request failed.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private headersSessionFor(method: string): string | undefined {
    if (method === "initialize") {
      if (this.mcpSessionId) throw new StreamableHttpTransportError("INVALID_STATE", "MCP HTTP session is already initialized.");
      return undefined;
    }
    // No retry, local fallback, or implicit reinitialization is permitted after a remote session is lost.
    if (!this.mcpSessionId) throw new StreamableHttpTransportError("INVALID_STATE", "MCP HTTP session has not been initialized.");
    return this.mcpSessionId;
  }

  private assertRunning(): void {
    if (this.state === "running") return;
    if (this.state === "closed" || this.state === "closing") throw new StreamableHttpTransportError("CLOSED", "MCP HTTP client is closed.");
    throw new StreamableHttpTransportError("INVALID_STATE", "MCP HTTP client has not been started.");
  }

  private sessionIdFor(context: McpRequestContext | undefined): string {
    const value = context?.sessionId ?? HOST_MCP_LOG_SESSION_ID;
    if (typeof value !== "string" || value.trim().length === 0) throw new StreamableHttpTransportError("PROTOCOL_ERROR", "MCP request context is invalid.");
    return value.trim();
  }

  private normalizeError(error: unknown): StreamableHttpTransportError {
    if (error instanceof StreamableHttpTransportError) return error;
    return new StreamableHttpTransportError("NETWORK_ERROR", "MCP HTTP request failed.");
  }

  private durationSince(startedAt: number): number {
    return Math.max(0, this.logClock.monotonicNow() - startedAt);
  }

  private appendLog(entry: Omit<McpInteractionLogEntry, "timestamp" | "serverId" | "transport">): void {
    this.interactionLogger?.append({
      ...entry,
      timestamp: this.logClock.now().toISOString(),
      serverId: this.serverId,
      transport: "STREAMABLE_HTTP",
      payload: sanitizeJsonRpcPayload(entry.payload),
    });
  }
}
