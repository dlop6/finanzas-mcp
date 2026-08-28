import type { McpInteractionLogReader } from "@/host/mcp-clients/mcp-interaction-log";
import { createWebMcpLogsService, type WebMcpLogsResponse } from "./mcp-logs";

export type WebMcpLogsErrorCode = "INVALID_REQUEST" | "HOST_UNAVAILABLE" | "LOGS_FAILED";

export type WebMcpLogsErrorResponse = {
  error: { code: WebMcpLogsErrorCode; message: string };
};

export type WebMcpLogsRuntimeProvider = () => Promise<{ interactionLogs: McpInteractionLogReader }>;

const bodyLimit = 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(status: number, code: WebMcpLogsErrorCode, message: string): Response {
  return Response.json({ error: { code, message } } satisfies WebMcpLogsErrorResponse, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function parseRequest(request: Request): Promise<{ chatSessionId?: string } | undefined> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return undefined;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > bodyLimit) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => key !== "sessionId")) return undefined;
  if (object.sessionId === undefined) return {};
  return typeof object.sessionId === "string" && uuidPattern.test(object.sessionId)
    ? { chatSessionId: object.sessionId }
    : undefined;
}

export function createWebMcpLogsHandler(getRuntime: WebMcpLogsRuntimeProvider) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST" || new URL(request.url).search) {
      return errorResponse(400, "INVALID_REQUEST", "La solicitud de logs MCP no es válida.");
    }
    const input = await parseRequest(request);
    if (!input) return errorResponse(400, "INVALID_REQUEST", "La solicitud de logs MCP no es válida.");
    let runtime: { interactionLogs: McpInteractionLogReader };
    try {
      runtime = await getRuntime();
    } catch {
      return errorResponse(503, "HOST_UNAVAILABLE", "Los logs MCP no están disponibles en este momento.");
    }
    try {
      const data: WebMcpLogsResponse = createWebMcpLogsService({ reader: runtime.interactionLogs }).list(input);
      return Response.json(data, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return errorResponse(502, "LOGS_FAILED", "No fue posible obtener los logs MCP.");
    }
  };
}
