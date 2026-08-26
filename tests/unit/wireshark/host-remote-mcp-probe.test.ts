import { describe, expect, it, vi } from "vitest";
import { InMemoryMcpInteractionLogStore } from "@/host/mcp-clients/mcp-interaction-log";
import type { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
import { createFinanceToolRegistry } from "@/servers/finance-mcp/composition";
import type { PrismaClient } from "@/database/generated/prisma/client";
import type { McpCallToolResult } from "@/shared/mcp";
import {
  HostRemoteMcpProbeError,
  runHostRemoteMcpProbe,
} from "@/scripts/wireshark/host-remote-mcp-probe";

const endpoint = "https://finanzas-mcp-server.onrender.com/mcp";
const tools = createFinanceToolRegistry({} as PrismaClient).list();

function appendLifecycleLogs(logs: InMemoryMcpInteractionLogStore, probeSessionId: string): void {
  const append = (sessionId: string, direction: "HOST_TO_MCP" | "MCP_TO_HOST", messageType: "request" | "response" | "notification", method: string, requestId?: number) => logs.append({
    timestamp: "2026-08-26T00:00:00.000Z", sessionId, serverId: "finance-mcp", transport: "STREAMABLE_HTTP", direction, messageType, method, ...(requestId === undefined ? {} : { requestId }), payload: "{}", status: direction === "MCP_TO_HOST" ? "SUCCEEDED" : "SENT",
  });
  append("HOST", "HOST_TO_MCP", "request", "initialize", 1);
  append("HOST", "MCP_TO_HOST", "response", "initialize", 1);
  append("HOST", "HOST_TO_MCP", "notification", "notifications/initialized");
  append("HOST", "HOST_TO_MCP", "request", "tools/list", 2);
  append("HOST", "MCP_TO_HOST", "response", "tools/list", 2);
  append(probeSessionId, "HOST_TO_MCP", "request", "tools/call", 3);
  append(probeSessionId, "MCP_TO_HOST", "response", "tools/call", 3);
}

function fakeClient(logs: InMemoryMcpInteractionLogStore, probeSessionId: string, toolResult: McpCallToolResult = { content: [{ type: "text", text: "ok" }], structuredContent: { currency: "GTQ", currentBalance: "19475.00" } }) {
  appendLifecycleLogs(logs, probeSessionId);
  return {
    state: "READY",
    toolsList: vi.fn(async () => ({ tools })),
    toolsCall: vi.fn(async () => toolResult),
    close: vi.fn(async () => undefined),
  } as unknown as McpLifecycleClient;
}

describe("Host remote MCP Wireshark probe", () => {
  it("uses the Host client lifecycle, discovers 24 tools, calls one read, and creates a safe summary", async () => {
    const logs = new InMemoryMcpInteractionLogStore();
    const client = fakeClient(logs, "probe-uuid");
    const writeSummary = vi.fn(async () => undefined);

    const summary = await runHostRemoteMcpProbe(endpoint, {
      logger: logs,
      idGenerator: () => "probe-uuid",
      startClient: async () => client,
      writeSummary,
    });

    expect(client.toolsList).toHaveBeenCalledOnce();
    expect(client.toolsCall).toHaveBeenCalledWith("get_current_balance", {}, { sessionId: "probe-uuid" });
    expect(client.close).toHaveBeenCalledOnce();
    expect(summary).toMatchObject({ toolCount: 24, readTool: "get_current_balance", transport: "STREAMABLE_HTTP", lifecycleValidated: true });
    expect(JSON.stringify(summary)).not.toContain("probe-uuid");
    expect(writeSummary).toHaveBeenCalledWith(summary);
  });

  it("rejects an insecure endpoint before starting a client", async () => {
    const startClient = vi.fn();
    await expect(runHostRemoteMcpProbe("http://localhost:3001/mcp", { startClient })).rejects.toMatchObject({ code: "INVALID_ENDPOINT" } satisfies Partial<HostRemoteMcpProbeError>);
    expect(startClient).not.toHaveBeenCalled();
  });

  it("closes the Host client when the only read result is an MCP error", async () => {
    const logs = new InMemoryMcpInteractionLogStore();
    const client = fakeClient(logs, "probe-uuid", { content: [{ type: "text" as const, text: "failed" }], isError: true });
    await expect(runHostRemoteMcpProbe(endpoint, { logger: logs, idGenerator: () => "probe-uuid", startClient: async () => client })).rejects.toMatchObject({ code: "READ_TOOL_FAILED" } satisfies Partial<HostRemoteMcpProbeError>);
    expect(client.close).toHaveBeenCalledOnce();
  });
});
