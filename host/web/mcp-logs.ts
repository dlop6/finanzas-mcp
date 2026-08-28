import {
  HOST_MCP_LOG_SESSION_ID,
  type McpInteractionLogEntry,
  type McpInteractionLogReader,
} from "@/host/mcp-clients/mcp-interaction-log";
import { WEB_DASHBOARD_LOG_SESSION_ID } from "./financial-dashboard";

export type WebMcpLogContext = "HOST" | "WEB_DASHBOARD" | "CHAT";

export type WebMcpLogEntry = Omit<McpInteractionLogEntry, "sessionId"> & {
  context: WebMcpLogContext;
};

export type WebMcpLogGroup = {
  context: WebMcpLogContext;
  label: string;
  entries: WebMcpLogEntry[];
};

export type WebMcpLogsResponse = {
  status: "ready";
  generatedAt: string;
  groups: WebMcpLogGroup[];
};

export type WebMcpLogsService = {
  list(input: { chatSessionId?: string }): WebMcpLogsResponse;
};

type WebMcpLogsClock = { now(): Date };

const labels: Record<WebMcpLogContext, string> = {
  HOST: "Lifecycle y discovery",
  WEB_DASHBOARD: "Dashboard",
  CHAT: "Conversación actual",
};

function group(reader: McpInteractionLogReader, sessionId: string, context: WebMcpLogContext): WebMcpLogGroup {
  const entries = reader.listBySession(sessionId).map((entry) => {
    const copy = structuredClone(entry);
    Reflect.deleteProperty(copy, "sessionId");
    return structuredClone({ ...copy, context }) as WebMcpLogEntry;
  });
  return { context, label: labels[context], entries };
}

export function createWebMcpLogsService(options: {
  reader: McpInteractionLogReader;
  now?: () => Date;
}): WebMcpLogsService {
  const clock: WebMcpLogsClock = { now: options.now ?? (() => new Date()) };
  return {
    list({ chatSessionId }) {
      const groups = [
        group(options.reader, HOST_MCP_LOG_SESSION_ID, "HOST"),
        group(options.reader, WEB_DASHBOARD_LOG_SESSION_ID, "WEB_DASHBOARD"),
      ];
      if (chatSessionId) groups.push(group(options.reader, chatSessionId, "CHAT"));
      return structuredClone({ status: "ready" as const, generatedAt: clock.now().toISOString(), groups });
    },
  };
}
