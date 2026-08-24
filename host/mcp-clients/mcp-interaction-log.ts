import type { JsonRpcId } from "@/shared/jsonrpc";

export const HOST_MCP_LOG_SESSION_ID = "HOST";
export const INVALID_MCP_PAYLOAD = "[invalid JSON-RPC payload omitted]";

export type McpLogDirection = "HOST_TO_MCP" | "MCP_TO_HOST";
export type McpLogMessageType = "request" | "response" | "notification" | "error";
export type McpLogStatus = "SENT" | "SUCCEEDED" | "REMOTE_ERROR" | "TRANSPORT_ERROR" | "PROTOCOL_ERROR";

export type McpInteractionLogEntry = {
  timestamp: string;
  sessionId: string;
  serverId: string;
  direction: McpLogDirection;
  messageType: McpLogMessageType;
  method?: string;
  requestId?: JsonRpcId;
  payload: string;
  status: McpLogStatus;
  durationMs?: number;
};

export type McpInteractionLogWriter = {
  append(entry: McpInteractionLogEntry): void;
};

export type McpInteractionLogReader = {
  listBySession(sessionId: string): McpInteractionLogEntry[];
};

export type McpInteractionLogClock = {
  now(): Date;
  monotonicNow(): number;
};

export const systemMcpInteractionLogClock: McpInteractionLogClock = {
  now: () => new Date(),
  monotonicNow: () => performance.now(),
};

const sensitiveKey = /^(?:authorization|api[_-]?key|database[_-]?url|password|secret|token)$/i;

function requireSessionId(sessionId: string): string {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new Error("MCP log session ID must contain text.");
  }
  return sessionId.trim();
}

function sanitizeValue(value: unknown): [unknown, boolean] {
  if (Array.isArray(value)) {
    let changed = false;
    const sanitized = value.map((item) => {
      const [next, itemChanged] = sanitizeValue(item);
      changed ||= itemChanged;
      return next;
    });
    return [sanitized, changed];
  }

  if (typeof value !== "object" || value === null) {
    return [value, false];
  }

  let changed = false;
  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (sensitiveKey.test(key)) {
      sanitized[key] = "[REDACTED]";
      changed = true;
      continue;
    }
    const [next, nestedChanged] = sanitizeValue(nestedValue);
    sanitized[key] = next;
    changed ||= nestedChanged;
  }
  return [sanitized, changed];
}

export function sanitizeJsonRpcPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as unknown;
    const [sanitized, changed] = sanitizeValue(parsed);
    return changed ? JSON.stringify(sanitized) : payload;
  } catch {
    return INVALID_MCP_PAYLOAD;
  }
}

export class InMemoryMcpInteractionLogStore implements McpInteractionLogWriter, McpInteractionLogReader {
  private readonly entries: McpInteractionLogEntry[] = [];

  append(entry: McpInteractionLogEntry): void {
    requireSessionId(entry.sessionId);
    this.entries.push(structuredClone({
      ...entry,
      sessionId: entry.sessionId.trim(),
      payload: sanitizeJsonRpcPayload(entry.payload),
    }));
  }

  listBySession(sessionId: string): McpInteractionLogEntry[] {
    const normalizedSessionId = requireSessionId(sessionId);
    return this.entries
      .filter((entry) => entry.sessionId === normalizedSessionId)
      .map((entry) => structuredClone(entry));
  }
}
