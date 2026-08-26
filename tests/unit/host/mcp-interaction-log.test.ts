import { describe, expect, it } from "vitest";
import {
  HOST_MCP_LOG_SESSION_ID,
  InMemoryMcpInteractionLogStore,
  INVALID_MCP_PAYLOAD,
  sanitizeJsonRpcPayload,
} from "@/host/mcp-clients/mcp-interaction-log";

describe("MCP interaction log store", () => {
  it("keeps ordered defensive entries isolated by session", () => {
    const store = new InMemoryMcpInteractionLogStore();
    store.append({ timestamp: "2026-08-24T00:00:00.000Z", sessionId: HOST_MCP_LOG_SESSION_ID, serverId: "finance-mcp", transport: "STDIO", direction: "HOST_TO_MCP", messageType: "request", method: "initialize", requestId: 1, payload: '{"jsonrpc":"2.0","id":1,"method":"initialize"}', status: "SENT" });
    store.append({ timestamp: "2026-08-24T00:00:01.000Z", sessionId: "session-a", serverId: "finance-mcp", transport: "STDIO", direction: "MCP_TO_HOST", messageType: "response", method: "tools/call", requestId: 2, payload: '{"jsonrpc":"2.0","id":2,"result":{}}', status: "SUCCEEDED", durationMs: 5 });

    const first = store.listBySession("session-a");
    first[0].payload = "changed";

    expect(store.listBySession("session-a")).toEqual([{ timestamp: "2026-08-24T00:00:01.000Z", sessionId: "session-a", serverId: "finance-mcp", transport: "STDIO", direction: "MCP_TO_HOST", messageType: "response", method: "tools/call", requestId: 2, payload: '{"jsonrpc":"2.0","id":2,"result":{}}', status: "SUCCEEDED", durationMs: 5 }]);
    expect(store.listBySession(HOST_MCP_LOG_SESSION_ID)).toHaveLength(1);
    expect(store.listBySession("missing")).toEqual([]);
  });

  it("redacts sensitive JSON values and omits malformed payloads", () => {
    expect(sanitizeJsonRpcPayload('{"params":{"token":"secret-value","safe":"ok"}}')).toBe('{"params":{"token":"[REDACTED]","safe":"ok"}}');
    expect(sanitizeJsonRpcPayload("not-json")).toBe(INVALID_MCP_PAYLOAD);
  });

  it("rejects empty session IDs", () => {
    const store = new InMemoryMcpInteractionLogStore();
    expect(() => store.listBySession(" ")).toThrow("session ID");
  });
});
