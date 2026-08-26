import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface, type Interface } from "node:readline";
import {
  isJsonRpcErrorResponse,
  isJsonRpcSuccessResponse,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  validateJsonRpcMessage,
  JsonRpcRequestIdGenerator,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcParams,
  type JsonRpcRequest,
} from "@/shared/jsonrpc";
import { JsonRpcRemoteError, type McpRequestContext } from "./mcp-jsonrpc-transport";
import {
  HOST_MCP_LOG_SESSION_ID,
  sanitizeJsonRpcPayload,
  systemMcpInteractionLogClock,
  type McpInteractionLogClock,
  type McpInteractionLogEntry,
  type McpInteractionLogWriter,
} from "./mcp-interaction-log";

export type StdioTransportErrorCode =
  | "INVALID_MESSAGE"
  | "INVALID_STATE"
  | "PROCESS_ERROR"
  | "PROCESS_EXIT"
  | "PROTOCOL_ERROR"
  | "WRITE_ERROR"
  | "CLOSED";

export class StdioTransportError extends Error {
  constructor(
    public readonly code: StdioTransportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StdioTransportError";
  }
}

export { JsonRpcRemoteError } from "./mcp-jsonrpc-transport";

export interface StdioJsonRpcClientOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  onStderr?: (text: string) => void;
  serverId?: string;
  interactionLogger?: McpInteractionLogWriter;
  logClock?: McpInteractionLogClock;
}

export type { McpRequestContext } from "./mcp-jsonrpc-transport";

interface PendingRequest {
  method: string;
  sessionId: string;
  payload: string;
  startedAt: number;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

type ClientState = "idle" | "running" | "closing" | "closed" | "failed";

function defaultStderrConsumer(text: string): void {
  process.stderr.write(text);
}

function writeLine(stream: ChildProcessWithoutNullStreams["stdin"], line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      stream.write(`${line}\n`, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

export class StdioJsonRpcClient {
  private readonly idGenerator = new JsonRpcRequestIdGenerator();
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly consumeStderr: (text: string) => void;
  private readonly serverId: string;
  private readonly interactionLogger: McpInteractionLogWriter | undefined;
  private readonly logClock: McpInteractionLogClock;
  private child: ChildProcessWithoutNullStreams | undefined;
  private outputReader: Interface | undefined;
  private state: ClientState = "idle";
  private closePromise: Promise<void> | undefined;

  constructor(private readonly options: StdioJsonRpcClientOptions) {
    this.consumeStderr = options.onStderr ?? defaultStderrConsumer;
    this.serverId = options.serverId ?? "finance-mcp";
    this.interactionLogger = options.interactionLogger;
    this.logClock = options.logClock ?? systemMcpInteractionLogClock;
  }

  async start(): Promise<void> {
    if (this.state === "running") {
      return;
    }

    if (this.state !== "idle") {
      throw new StdioTransportError("INVALID_STATE", "JSON-RPC STDIO client cannot be started in its current state");
    }

    const child = spawn(this.options.command, [...this.options.args], {
      cwd: this.options.cwd,
      env: this.options.env,
      shell: false,
      stdio: "pipe",
    });

    this.child = child;
    this.attachChildListeners(child);

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => {
        if (this.state === "idle") {
          this.state = "running";
        }
        resolve();
      });
      child.once("error", (error) => {
        const transportError = new StdioTransportError("PROCESS_ERROR", "MCP server process could not start");
        this.failTransport(transportError);
        reject(error);
      });
    }).catch(() => {
      throw new StdioTransportError("PROCESS_ERROR", "MCP server process could not start");
    });
  }

  request<Result>(method: string, params?: JsonRpcParams, context?: McpRequestContext): Promise<Result> {
    const stateError = this.requestStateError();
    if (stateError) {
      return Promise.reject(stateError);
    }

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.idGenerator.next(),
      method,
      ...(params === undefined ? {} : { params }),
    };
    const validation = validateJsonRpcMessage(request);

    if (!validation.ok) {
      return Promise.reject(new StdioTransportError("INVALID_MESSAGE", "Invalid JSON-RPC request"));
    }

    let serialized: string;
    try {
      serialized = serializeJsonRpcMessage(request);
    } catch {
      return Promise.reject(new StdioTransportError("INVALID_MESSAGE", "JSON-RPC request could not be serialized"));
    }

    return new Promise<Result>((resolve, reject) => {
      const pending: PendingRequest = {
        method: request.method,
        sessionId: this.sessionIdFor(context),
        payload: serialized,
        startedAt: this.logClock.monotonicNow(),
        resolve: (result) => resolve(result as Result),
        reject,
      };
      this.pending.set(request.id, pending);
      this.appendLog({
        sessionId: pending.sessionId,
        direction: "HOST_TO_MCP",
        messageType: "request",
        method: request.method,
        requestId: request.id,
        payload: serialized,
        status: "SENT",
      });

      void writeLine(this.child!.stdin, serialized).catch(() => {
        const currentPending = this.pending.get(request.id);
        if (!currentPending) {
          return;
        }

        this.pending.delete(request.id);
        this.rejectPendingRequest(request.id, currentPending, new StdioTransportError("WRITE_ERROR", "Could not write JSON-RPC request to MCP server"), "TRANSPORT_ERROR");
      });
    });
  }

  async notify(method: string, params?: JsonRpcParams, context?: McpRequestContext): Promise<void> {
    const stateError = this.requestStateError();
    if (stateError) {
      throw stateError;
    }

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    };
    const validation = validateJsonRpcMessage(notification);

    if (!validation.ok) {
      throw new StdioTransportError("INVALID_MESSAGE", "Invalid JSON-RPC notification");
    }

    let serialized: string;
    try {
      serialized = serializeJsonRpcMessage(notification);
    } catch {
      throw new StdioTransportError("INVALID_MESSAGE", "JSON-RPC notification could not be serialized");
    }

    const sessionId = this.sessionIdFor(context);
    this.appendLog({
      sessionId,
      direction: "HOST_TO_MCP",
      messageType: "notification",
      method: notification.method,
      payload: serialized,
      status: "SENT",
    });
    await writeLine(this.child!.stdin, serialized).catch(() => {
      this.appendLog({
        sessionId,
        direction: "HOST_TO_MCP",
        messageType: "error",
        method: notification.method,
        payload: serialized,
        status: "TRANSPORT_ERROR",
      });
      throw new StdioTransportError("WRITE_ERROR", "Could not write JSON-RPC notification to MCP server");
    });
  }

  async close(): Promise<void> {
    if (this.state === "closed") {
      return;
    }

    if (this.closePromise) {
      return this.closePromise;
    }

    if (this.state === "idle") {
      this.state = "closed";
      return;
    }

    this.state = "closing";
    this.rejectPending(new StdioTransportError("CLOSED", "JSON-RPC STDIO client was closed"), "TRANSPORT_ERROR");

    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.state = "closed";
      return;
    }

    this.closePromise = this.stopChild(child);
    return this.closePromise;
  }

  private attachChildListeners(child: ChildProcessWithoutNullStreams): void {
    this.outputReader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.outputReader.on("line", (line) => this.handleStdoutLine(line));
    child.stderr.on("data", (chunk: Buffer) => this.consumeStderr(chunk.toString()));
    child.on("error", () => {
      this.failTransport(new StdioTransportError("PROCESS_ERROR", "MCP server process failed"));
    });
    child.on("exit", (code, signal) => {
      if (this.state === "closing" || this.state === "closed") {
        return;
      }

      const details = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.failTransport(new StdioTransportError("PROCESS_EXIT", `MCP server process exited with ${details}`));
    });
    child.on("close", () => {
      this.outputReader?.close();

      if (this.state === "closing") {
        this.state = "closed";
      }
    });
  }

  private handleStdoutLine(line: string): void {
    const parsed = parseJsonRpcMessage(line);

    if (!parsed.ok || (!isJsonRpcSuccessResponse(parsed.message) && !isJsonRpcErrorResponse(parsed.message))) {
      this.appendLog({
        sessionId: HOST_MCP_LOG_SESSION_ID,
        direction: "MCP_TO_HOST",
        messageType: "error",
        payload: line,
        status: "PROTOCOL_ERROR",
      });
      this.failTransport(new StdioTransportError("PROTOCOL_ERROR", "MCP server emitted an invalid JSON-RPC response"));
      return;
    }

    const response = parsed.message;
    if (response.id === null) {
      this.appendLog({
        sessionId: HOST_MCP_LOG_SESSION_ID,
        direction: "MCP_TO_HOST",
        messageType: "error",
        payload: line,
        status: "PROTOCOL_ERROR",
      });
      this.failTransport(new StdioTransportError("PROTOCOL_ERROR", "MCP server emitted a response without a request ID"));
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      this.appendLog({
        sessionId: HOST_MCP_LOG_SESSION_ID,
        direction: "MCP_TO_HOST",
        messageType: "error",
        requestId: response.id,
        payload: line,
        status: "PROTOCOL_ERROR",
      });
      this.failTransport(new StdioTransportError("PROTOCOL_ERROR", "MCP server emitted a response with an unknown ID"));
      return;
    }

    this.pending.delete(response.id);
    const durationMs = this.durationSince(pending.startedAt);

    if (isJsonRpcSuccessResponse(response)) {
      this.appendLog({
        sessionId: pending.sessionId,
        direction: "MCP_TO_HOST",
        messageType: "response",
        method: pending.method,
        requestId: response.id,
        payload: line,
        status: "SUCCEEDED",
        durationMs,
      });
      pending.resolve(response.result);
      return;
    }

    this.appendLog({
      sessionId: pending.sessionId,
      direction: "MCP_TO_HOST",
      messageType: "error",
      method: pending.method,
      requestId: response.id,
      payload: line,
      status: "REMOTE_ERROR",
      durationMs,
    });
    pending.reject(new JsonRpcRemoteError(response.id, response.error.code, response.error.message, response.error.data));
  }

  private requestStateError(): StdioTransportError | undefined {
    if (this.state === "running" && this.child) {
      return undefined;
    }

    if (this.state === "closed" || this.state === "closing") {
      return new StdioTransportError("CLOSED", "JSON-RPC STDIO client is closed");
    }

    return new StdioTransportError("INVALID_STATE", "JSON-RPC STDIO client has not been started");
  }

  private failTransport(error: StdioTransportError): void {
    if (this.state === "closed" || this.state === "failed") {
      return;
    }

    this.state = "failed";
    this.rejectPending(error, error.code === "PROTOCOL_ERROR" ? "PROTOCOL_ERROR" : "TRANSPORT_ERROR");

    if (this.child && !this.child.killed && this.child.exitCode === null) {
      this.child.stdin.end();
      this.child.kill();
    }
  }

  private rejectPending(error: Error, status: "TRANSPORT_ERROR" | "PROTOCOL_ERROR"): void {
    for (const [requestId, pending] of this.pending.entries()) {
      this.rejectPendingRequest(requestId, pending, error, status);
    }

    this.pending.clear();
  }

  private rejectPendingRequest(
    requestId: JsonRpcId,
    pending: PendingRequest,
    error: Error,
    status: "TRANSPORT_ERROR" | "PROTOCOL_ERROR",
  ): void {
    this.appendLog({
      sessionId: pending.sessionId,
      direction: "HOST_TO_MCP",
      messageType: "error",
      method: pending.method,
      requestId,
      payload: pending.payload,
      status,
      durationMs: this.durationSince(pending.startedAt),
    });
    pending.reject(error);
  }

  private sessionIdFor(context: McpRequestContext | undefined): string {
    const sessionId = context?.sessionId ?? HOST_MCP_LOG_SESSION_ID;
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new StdioTransportError("INVALID_MESSAGE", "MCP request context has an invalid session ID");
    }
    return sessionId.trim();
  }

  private durationSince(startedAt: number): number {
    return Math.max(0, this.logClock.monotonicNow() - startedAt);
  }

  private appendLog(entry: Omit<McpInteractionLogEntry, "timestamp" | "serverId" | "transport">): void {
    this.interactionLogger?.append({
      ...entry,
      timestamp: this.logClock.now().toISOString(),
      serverId: this.serverId,
      transport: "STDIO",
      payload: sanitizeJsonRpcPayload(entry.payload),
    });
  }

  private async stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    const closed = once(child, "close").then(() => undefined);
    child.stdin.end();

    const endedNaturally = await Promise.race([
      closed.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]);

    if (!endedNaturally && child.exitCode === null && !child.killed) {
      child.kill();
    }

    await closed;
    this.state = "closed";
  }
}
