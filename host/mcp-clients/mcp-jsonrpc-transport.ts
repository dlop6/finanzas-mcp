import type { JsonRpcId, JsonRpcParams } from "@/shared/jsonrpc";

export type McpRequestContext = {
  sessionId: string;
};

export type McpJsonRpcTransport = {
  request<Result>(method: string, params?: JsonRpcParams, context?: McpRequestContext): Promise<Result>;
  notify(method: string, params?: JsonRpcParams, context?: McpRequestContext): Promise<void>;
  close(): Promise<void>;
};

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
