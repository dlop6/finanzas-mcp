import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FINANCE_MCP_REMOTE_TIMEOUT_MS,
  FinanceMcpClientConfigurationError,
  loadFinanceMcpClientConfig,
  startFinanceMcpSession,
  type FinanceMcpClientConfig,
} from "@/host/mcp-clients/finance-mcp-client";
import {
  HOST_MCP_LOG_SESSION_ID,
  InMemoryMcpInteractionLogStore,
  type McpInteractionLogEntry,
  type McpLogMessageType,
  type McpLogStatus,
} from "@/host/mcp-clients/mcp-interaction-log";
import type { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
import { registerFinanceMcpTools } from "@/host/orchestration/finance-mcp-tools";
import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";
import type { JsonRpcId } from "@/shared/jsonrpc";

export type SafeHostLogEntry = {
  context: "HOST" | "PROBE_SESSION";
  direction: "HOST_TO_MCP" | "MCP_TO_HOST";
  messageType: McpLogMessageType;
  method?: string;
  requestId?: JsonRpcId;
  status: McpLogStatus;
  durationMs?: number;
};

export type HostRemoteCaptureSummary = {
  toolCount: 24;
  readTool: "get_current_balance";
  transport: "STREAMABLE_HTTP";
  lifecycleValidated: true;
  hostLogEntries: SafeHostLogEntry[];
};

export class HostRemoteMcpProbeError extends Error {
  constructor(
    public readonly code:
      | "INVALID_ENDPOINT"
      | "CLIENT_START_FAILED"
      | "LIFECYCLE_MISMATCH"
      | "TOOL_CONTRACT_MISMATCH"
      | "READ_TOOL_FAILED"
      | "LOG_CORRELATION_FAILED"
      | "SUMMARY_WRITE_FAILED"
      | "CLIENT_CLOSE_FAILED",
  ) {
    super("Host remote MCP capture probe failed.");
    this.name = "HostRemoteMcpProbeError";
  }
}

export type HostRemoteMcpProbeClient = Pick<McpLifecycleClient, "state" | "toolsList" | "toolsCall" | "close">;

export type HostRemoteMcpProbeOptions = {
  logger?: InMemoryMcpInteractionLogStore;
  idGenerator?: () => string;
  startClient?: (config: FinanceMcpClientConfig, logger: InMemoryMcpInteractionLogStore) => Promise<HostRemoteMcpProbeClient>;
  writeSummary?: (summary: HostRemoteCaptureSummary) => Promise<void>;
};

function loadExplicitRemoteConfig(endpoint: string): FinanceMcpClientConfig {
  try {
    return loadFinanceMcpClientConfig({
      FINANCE_MCP_MODE: "remote",
      FINANCE_MCP_REMOTE_URL: endpoint,
    });
  } catch (error) {
    if (error instanceof FinanceMcpClientConfigurationError) {
      throw new HostRemoteMcpProbeError("INVALID_ENDPOINT");
    }
    throw new HostRemoteMcpProbeError("INVALID_ENDPOINT");
  }
}

function safeEntry(entry: McpInteractionLogEntry, probeSessionId: string): SafeHostLogEntry {
  return {
    context: entry.sessionId === HOST_MCP_LOG_SESSION_ID ? "HOST" : entry.sessionId === probeSessionId ? "PROBE_SESSION" : "PROBE_SESSION",
    direction: entry.direction,
    messageType: entry.messageType,
    ...(entry.method === undefined ? {} : { method: entry.method }),
    ...(entry.requestId === undefined ? {} : { requestId: entry.requestId }),
    status: entry.status,
    ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
  };
}

function hasLog(entries: readonly McpInteractionLogEntry[], direction: McpInteractionLogEntry["direction"], messageType: McpInteractionLogEntry["messageType"], method: string): boolean {
  return entries.some((entry) => entry.direction === direction && entry.messageType === messageType && entry.method === method && entry.transport === "STREAMABLE_HTTP" && entry.serverId === "finance-mcp");
}

function summarizeLogs(logger: InMemoryMcpInteractionLogStore, probeSessionId: string): SafeHostLogEntry[] {
  const hostEntries = logger.listBySession(HOST_MCP_LOG_SESSION_ID);
  const probeEntries = logger.listBySession(probeSessionId);
  const valid = hasLog(hostEntries, "HOST_TO_MCP", "request", "initialize")
    && hasLog(hostEntries, "MCP_TO_HOST", "response", "initialize")
    && hasLog(hostEntries, "HOST_TO_MCP", "notification", "notifications/initialized")
    && hasLog(hostEntries, "HOST_TO_MCP", "request", "tools/list")
    && hasLog(hostEntries, "MCP_TO_HOST", "response", "tools/list")
    && hasLog(probeEntries, "HOST_TO_MCP", "request", "tools/call")
    && hasLog(probeEntries, "MCP_TO_HOST", "response", "tools/call");
  if (!valid) throw new HostRemoteMcpProbeError("LOG_CORRELATION_FAILED");
  return [...hostEntries, ...probeEntries].map((entry) => safeEntry(entry, probeSessionId));
}

export async function runHostRemoteMcpProbe(endpoint: string, options: HostRemoteMcpProbeOptions = {}): Promise<HostRemoteCaptureSummary> {
  const config = loadExplicitRemoteConfig(endpoint);
  const logger = options.logger ?? new InMemoryMcpInteractionLogStore();
  const probeSessionId = (options.idGenerator ?? randomUUID)();
  if (!probeSessionId.trim()) throw new HostRemoteMcpProbeError("LIFECYCLE_MISMATCH");
  const startClient = options.startClient ?? (async (selectedConfig, interactionLogger) => startFinanceMcpSession({ config: selectedConfig, interactionLogger }));
  let client: HostRemoteMcpProbeClient | undefined;
  let primaryError: unknown;

  try {
    try {
      client = await startClient(config, logger);
    } catch {
      throw new HostRemoteMcpProbeError("CLIENT_START_FAILED");
    }
    if (client.state !== "READY") throw new HostRemoteMcpProbeError("LIFECYCLE_MISMATCH");

    const registry = new HostMcpToolRegistry();
    try {
      await registerFinanceMcpTools(registry, client);
    } catch {
      throw new HostRemoteMcpProbeError("TOOL_CONTRACT_MISMATCH");
    }
    const registered = registry.list();
    const writeCount = registered.filter((tool) => tool.isWriteOperation).length;
    const readCount = registered.length - writeCount;
    if (registered.length !== 24 || writeCount !== 15 || readCount !== 9 || registered.some((tool) => tool.serverId !== "finance-mcp")) {
      throw new HostRemoteMcpProbeError("TOOL_CONTRACT_MISMATCH");
    }

    let balance;
    try {
      balance = await client.toolsCall("get_current_balance", {}, { sessionId: probeSessionId });
    } catch {
      throw new HostRemoteMcpProbeError("READ_TOOL_FAILED");
    }
    const balanceData = balance.structuredContent as { currency?: unknown; currentBalance?: unknown } | undefined;
    if (balance.isError || balanceData?.currency !== "GTQ" || typeof balanceData.currentBalance !== "string" || !/^\d+\.\d{2}$/.test(balanceData.currentBalance)) {
      throw new HostRemoteMcpProbeError("READ_TOOL_FAILED");
    }

    const summary: HostRemoteCaptureSummary = {
      toolCount: 24,
      readTool: "get_current_balance",
      transport: "STREAMABLE_HTTP",
      lifecycleValidated: true,
      hostLogEntries: summarizeLogs(logger, probeSessionId),
    };
    try {
      await options.writeSummary?.(summary);
    } catch {
      throw new HostRemoteMcpProbeError("SUMMARY_WRITE_FAILED");
    }
    return summary;
  } catch (error) {
    primaryError = error;
    if (error instanceof HostRemoteMcpProbeError) throw error;
    throw new HostRemoteMcpProbeError("READ_TOOL_FAILED");
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        if (primaryError === undefined) throw new HostRemoteMcpProbeError("CLIENT_CLOSE_FAILED");
      }
    }
  }
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  const [endpoint, summaryPath] = process.argv.slice(2);
  const writeSummary = summaryPath === undefined
    ? undefined
    : async (summary: HostRemoteCaptureSummary) => writeFile(summaryPath, `${JSON.stringify(summary)}\n`, "utf8");
  runHostRemoteMcpProbe(endpoint ?? "", { writeSummary })
    .then(() => process.stdout.write("Host remote MCP capture probe completed: 24 tools and one read operation.\n"))
    .catch((error: unknown) => {
      const code = error instanceof HostRemoteMcpProbeError ? error.code : "READ_TOOL_FAILED";
      process.stderr.write(`Host remote MCP capture probe failed: ${code}.\n`);
      process.exitCode = 1;
    });
}

export { FINANCE_MCP_REMOTE_TIMEOUT_MS };
