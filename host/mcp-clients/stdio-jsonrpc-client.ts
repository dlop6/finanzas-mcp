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

export class JsonRpcRemoteError<Data = unknown> extends Error {
  constructor(
    public readonly id: JsonRpcId | null,
    public readonly code: number,
    message: string,
    public readonly data?: Data,
  ) {
    super(message);
    this.name = "JsonRpcRemoteError";
  }
}

export interface StdioJsonRpcClientOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  onStderr?: (text: string) => void;
}

interface PendingRequest {
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
  private child: ChildProcessWithoutNullStreams | undefined;
  private outputReader: Interface | undefined;
  private state: ClientState = "idle";
  private closePromise: Promise<void> | undefined;

  constructor(private readonly options: StdioJsonRpcClientOptions) {
    this.consumeStderr = options.onStderr ?? defaultStderrConsumer;
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
        const transportError = new StdioTransportError("PROCESS_ERROR", "Finance MCP process could not start");
        this.failTransport(transportError);
        reject(error);
      });
    }).catch(() => {
      throw new StdioTransportError("PROCESS_ERROR", "Finance MCP process could not start");
    });
  }

  request<Result>(method: string, params?: JsonRpcParams): Promise<Result> {
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
      this.pending.set(request.id, {
        resolve: (result) => resolve(result as Result),
        reject,
      });

      void writeLine(this.child!.stdin, serialized).catch(() => {
        const pending = this.pending.get(request.id);
        if (!pending) {
          return;
        }

        this.pending.delete(request.id);
        pending.reject(new StdioTransportError("WRITE_ERROR", "Could not write JSON-RPC request to Finance MCP"));
      });
    });
  }

  async notify(method: string, params?: JsonRpcParams): Promise<void> {
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

    await writeLine(this.child!.stdin, serialized).catch(() => {
      throw new StdioTransportError("WRITE_ERROR", "Could not write JSON-RPC notification to Finance MCP");
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
    this.rejectPending(new StdioTransportError("CLOSED", "JSON-RPC STDIO client was closed"));

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
      this.failTransport(new StdioTransportError("PROCESS_ERROR", "Finance MCP process failed"));
    });
    child.on("exit", (code, signal) => {
      if (this.state === "closing" || this.state === "closed") {
        return;
      }

      const details = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.failTransport(new StdioTransportError("PROCESS_EXIT", `Finance MCP process exited with ${details}`));
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
      this.failTransport(new StdioTransportError("PROTOCOL_ERROR", "Finance MCP emitted an invalid JSON-RPC response"));
      return;
    }

    const response = parsed.message;
    if (response.id === null) {
      this.failTransport(new StdioTransportError("PROTOCOL_ERROR", "Finance MCP emitted a response without a request ID"));
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      this.failTransport(new StdioTransportError("PROTOCOL_ERROR", "Finance MCP emitted a response with an unknown ID"));
      return;
    }

    this.pending.delete(response.id);

    if (isJsonRpcSuccessResponse(response)) {
      pending.resolve(response.result);
      return;
    }

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
    this.rejectPending(error);

    if (this.child && !this.child.killed && this.child.exitCode === null) {
      this.child.stdin.end();
      this.child.kill();
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }

    this.pending.clear();
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
