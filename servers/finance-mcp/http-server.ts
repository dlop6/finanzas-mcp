import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  createInternalErrorResponse,
  createInvalidRequestResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
  parseJsonRpcMessage,
  serializeJsonRpcMessage,
  type JsonRpcErrorResponse,
  type JsonRpcRequest,
  type JsonRpcSuccessResponse,
} from "@/shared/jsonrpc";
import { MCP_METHODS, MCP_PROTOCOL_VERSION } from "@/shared/mcp";
import type { FinanceMcpMessageHandler } from "./message-handler";

export const FINANCE_MCP_HTTP_PATH = "/mcp";
export const FINANCE_MCP_HTTP_MAX_BODY_BYTES = 1024 * 1024;

export type FinanceMcpHttpConfig = {
  host: string;
  port: number;
  allowedOrigins: readonly string[];
};

export type FinanceMcpHttpEnvironment = Record<string, string | undefined>;

export class FinanceMcpHttpConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceMcpHttpConfigurationError";
  }
}

export class FinanceMcpHttpServerError extends Error {
  constructor(public readonly code: "BODY_TOO_LARGE" | "BODY_READ_FAILED", message: string) {
    super(message);
    this.name = "FinanceMcpHttpServerError";
  }
}

type FinanceMcpHttpSession = { handler: FinanceMcpMessageHandler };

export type CreateFinanceMcpHttpServerOptions = {
  createHandler: () => FinanceMcpMessageHandler;
  config?: FinanceMcpHttpConfig;
  diagnostics?: (message: string) => void;
  sessionIdGenerator?: () => string;
};

function parsePort(value: string | undefined): number {
  if (!value?.trim()) return 3001;
  if (!/^[1-9][0-9]*$/.test(value.trim())) throw new FinanceMcpHttpConfigurationError("PORT must be a valid TCP port.");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) throw new FinanceMcpHttpConfigurationError("PORT must be a valid TCP port.");
  return port;
}

function normalizeOrigin(value: string): string {
  try {
    const origin = new URL(value).origin;
    if (origin === "null" || origin !== value.replace(/\/$/, "")) throw new Error();
    return origin;
  } catch {
    throw new FinanceMcpHttpConfigurationError("MCP_ALLOWED_ORIGINS contains an invalid origin.");
  }
}

export function loadFinanceMcpHttpConfig(environment: FinanceMcpHttpEnvironment = process.env): FinanceMcpHttpConfig {
  const host = environment.MCP_HTTP_HOST?.trim() || "127.0.0.1";
  if (!host || /[\s/]/.test(host)) throw new FinanceMcpHttpConfigurationError("MCP_HTTP_HOST is invalid.");
  const origins = environment.MCP_ALLOWED_ORIGINS?.trim()
    ? environment.MCP_ALLOWED_ORIGINS.split(",").map((origin) => normalizeOrigin(origin.trim()))
    : [];
  return { host, port: parsePort(environment.PORT), allowedOrigins: [...new Set(origins)] };
}

function responseJson(response: ServerResponse, status: number, body: JsonRpcSuccessResponse | JsonRpcErrorResponse, sessionId?: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (sessionId) response.setHeader("MCP-Session-Id", sessionId);
  response.end(serializeJsonRpcMessage(body));
}

function responseStatus(response: ServerResponse, status: number, allow?: string): void {
  response.statusCode = status;
  if (allow) response.setHeader("Allow", allow);
  response.end();
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function acceptsMcp(request: IncomingMessage): boolean {
  const accept = header(request, "accept")?.toLowerCase() ?? "";
  return accept.includes("application/json") && accept.includes("text/event-stream");
}

function hasJsonContentType(request: IncomingMessage): boolean {
  return header(request, "content-type")?.toLowerCase().split(";", 1)[0].trim() === "application/json";
}

function isAllowedOrigin(request: IncomingMessage, allowedOrigins: readonly string[]): boolean {
  const origin = header(request, "origin");
  return origin === undefined || allowedOrigins.includes(origin);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > FINANCE_MCP_HTTP_MAX_BODY_BYTES) {
        request.resume();
        throw new FinanceMcpHttpServerError("BODY_TOO_LARGE", "MCP request body is too large.");
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof FinanceMcpHttpServerError) throw error;
    throw new FinanceMcpHttpServerError("BODY_READ_FAILED", "MCP request body could not be read.");
  }
  return Buffer.concat(chunks).toString("utf8");
}

function validSessionId(value: string): boolean {
  return /^[\x21-\x7e]+$/.test(value);
}

function responseForHandler(
  result: JsonRpcSuccessResponse | JsonRpcErrorResponse | undefined,
  request: JsonRpcRequest,
): JsonRpcSuccessResponse | JsonRpcErrorResponse {
  if ((isJsonRpcSuccessResponse(result) || (result !== undefined && "error" in result)) && result.id === request.id) return result;
  return createInternalErrorResponse(request.id);
}

export function createFinanceMcpHttpServer(options: CreateFinanceMcpHttpServerOptions): Server {
  const config = options.config ?? loadFinanceMcpHttpConfig();
  const diagnostics = options.diagnostics ?? (() => undefined);
  const newSessionId = options.sessionIdGenerator ?? randomUUID;
  const sessions = new Map<string, FinanceMcpHttpSession>();

  return createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== FINANCE_MCP_HTTP_PATH) return responseStatus(response, 404);
    if (!isAllowedOrigin(request, config.allowedOrigins)) return responseStatus(response, 403);

    if (request.method === "GET") return responseStatus(response, 405, "POST, DELETE");
    if (request.method === "DELETE") {
      const sessionId = header(request, "mcp-session-id");
      if (!sessionId || !validSessionId(sessionId) || header(request, "mcp-protocol-version") !== MCP_PROTOCOL_VERSION) return responseStatus(response, 400);
      if (!sessions.delete(sessionId)) return responseStatus(response, 404);
      return responseStatus(response, 204);
    }
    if (request.method !== "POST") return responseStatus(response, 405, "POST, DELETE");
    if (!hasJsonContentType(request)) return responseStatus(response, 415);
    if (!acceptsMcp(request)) return responseStatus(response, 406);

    let body: string;
    try {
      body = await readBody(request);
    } catch (error) {
      return responseStatus(response, error instanceof FinanceMcpHttpServerError && error.code === "BODY_TOO_LARGE" ? 413 : 400);
    }
    const parsed = parseJsonRpcMessage(body);
    if (!parsed.ok) return responseJson(response, 400, parsed.error);
    const message = parsed.message;
    if (!isJsonRpcRequest(message) && !isJsonRpcNotification(message)) {
      return responseJson(response, 400, createInvalidRequestResponse("id" in message ? message.id : null));
    }

    const sessionId = header(request, "mcp-session-id");
    const isInitialize = isJsonRpcRequest(message) && message.method === MCP_METHODS.INITIALIZE;
    if (isInitialize && sessionId !== undefined) return responseJson(response, 400, createInvalidRequestResponse(message.id));
    if (!isInitialize && header(request, "mcp-protocol-version") !== MCP_PROTOCOL_VERSION) {
      return responseJson(response, 400, createInvalidRequestResponse(isJsonRpcRequest(message) ? message.id : null));
    }

    let handler: FinanceMcpMessageHandler;
    let issuedSessionId: string | undefined;
    if (isInitialize) {
      handler = options.createHandler();
    } else {
      if (!sessionId || !validSessionId(sessionId)) return responseJson(response, 400, createInvalidRequestResponse(isJsonRpcRequest(message) ? message.id : null));
      const session = sessions.get(sessionId);
      if (!session) return responseStatus(response, 404);
      handler = session.handler;
    }

    if (isJsonRpcNotification(message)) {
      try { await handler(message); } catch { diagnostics("Finance MCP HTTP notification handler failed"); }
      return responseStatus(response, 202);
    }

    let result: JsonRpcSuccessResponse | JsonRpcErrorResponse | undefined;
    const rpcRequest = message as JsonRpcRequest;
    try { result = await handler(rpcRequest); } catch { diagnostics("Finance MCP HTTP request handler failed"); result = createInternalErrorResponse(rpcRequest.id); }
    const rpcResponse = responseForHandler(result, rpcRequest);
    if (isInitialize && isJsonRpcSuccessResponse(rpcResponse)) {
      issuedSessionId = newSessionId();
      if (!validSessionId(issuedSessionId) || sessions.has(issuedSessionId)) return responseJson(response, 500, createInternalErrorResponse(rpcRequest.id));
      sessions.set(issuedSessionId, { handler });
    }
    return responseJson(response, 200, rpcResponse, issuedSessionId);
  });
}
