import { describe, expect, it } from "vitest";
import {
  createWebMcpLogsHandler,
  createWebMcpLogsService,
  HOST_MCP_LOG_SESSION_ID,
  WEB_DASHBOARD_LOG_SESSION_ID,
} from "@/host/web";
import type { McpInteractionLogEntry, McpInteractionLogReader } from "@/host/mcp-clients/mcp-interaction-log";

const chatId = "78c5b11a-2c07-4e6e-9709-e32f776f6e6d";

function entry(sessionId: string, patch: Partial<McpInteractionLogEntry> = {}): McpInteractionLogEntry {
  return {
    timestamp: "2026-08-30T18:00:00.000Z",
    sessionId,
    serverId: "finance-mcp",
    transport: "STREAMABLE_HTTP",
    direction: "HOST_TO_MCP",
    messageType: "request",
    method: "tools/list",
    requestId: 1,
    payload: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    status: "SENT",
    ...patch,
  };
}

function reader(entries: McpInteractionLogEntry[]): McpInteractionLogReader {
  return {
    listBySession(sessionId) {
      return entries.filter((item) => item.sessionId === sessionId).map((item) => structuredClone(item));
    },
  };
}

describe("Web MCP logs", () => {
  it("exposes only the approved contexts, preserves each capture order, and aliases the chat session", () => {
    const service = createWebMcpLogsService({
      reader: reader([
        entry(HOST_MCP_LOG_SESSION_ID, { method: "initialize", requestId: 1 }),
        entry(HOST_MCP_LOG_SESSION_ID, { method: "tools/list", requestId: 2 }),
        entry(WEB_DASHBOARD_LOG_SESSION_ID, { method: "get_current_balance", requestId: 3 }),
        entry(chatId, { serverId: "git-mcp", transport: "STDIO", method: "git_status", requestId: 4 }),
        entry("another-session", { method: "record_income", requestId: 5 }),
      ]),
      now: () => new Date("2026-08-30T19:00:00.000Z"),
    });

    const data = service.list({ chatSessionId: chatId });
    expect(data.groups.map((group) => group.context)).toEqual(["HOST", "WEB_DASHBOARD", "CHAT"]);
    expect(data.groups[0].entries.map((item) => item.method)).toEqual(["initialize", "tools/list"]);
    expect(data.groups[2].entries).toMatchObject([{ context: "CHAT", serverId: "git-mcp", transport: "STDIO", method: "git_status" }]);
    expect(JSON.stringify(data)).not.toContain(chatId);
    expect(JSON.stringify(data)).not.toContain("another-session");
  });

  it("keeps the stored payload literal and returns defensive copies", () => {
    const source = entry(HOST_MCP_LOG_SESSION_ID, { payload: '{"params":{"token":"[REDACTED]","safe":"<b>literal</b>"}}' });
    const service = createWebMcpLogsService({ reader: reader([source]) });
    const first = service.list({});
    first.groups[0].entries[0].payload = "changed";
    expect(service.list({}).groups[0].entries[0].payload).toBe(source.payload);
  });

  it("uses a strict no-store POST handler without exposing internal failures", async () => {
    const handler = createWebMcpLogsHandler(async () => ({
      interactionLogs: reader([entry(HOST_MCP_LOG_SESSION_ID)]),
    }));
    const response = await handler(new Request("http://localhost/api/mcp-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: chatId }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toContain(chatId);

    const invalid = await handler(new Request("http://localhost/api/mcp-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "not-a-uuid", extra: true }),
    }));
    expect(invalid.status).toBe(400);

    const unavailable = createWebMcpLogsHandler(async () => { throw new Error("https://secret.example"); });
    const failure = await unavailable(new Request("http://localhost/api/mcp-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }));
    expect(failure.status).toBe(503);
    expect(JSON.stringify(await failure.json())).not.toContain("secret.example");

    const broken = createWebMcpLogsHandler(async () => ({ interactionLogs: { listBySession: () => { throw new Error("secret payload"); } } }));
    const brokenResponse = await broken(new Request("http://localhost/api/mcp-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }));
    expect(brokenResponse.status).toBe(502);
    expect(JSON.stringify(await brokenResponse.json())).not.toContain("secret payload");
  });
});
