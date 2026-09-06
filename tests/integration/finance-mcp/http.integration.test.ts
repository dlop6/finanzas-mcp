import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinanceToolRegistry } from "@/servers/finance-mcp/composition";
import { createFinanceMcpHttpServer } from "@/servers/finance-mcp/http-server";
import { FinanceMcpLifecycle } from "@/servers/finance-mcp/lifecycle";
import { startFinanceMcpSession, FINANCE_MCP_REMOTE_TIMEOUT_MS } from "@/host/mcp-clients/finance-mcp-client";
import { InMemoryMcpInteractionLogStore } from "@/host/mcp-clients/mcp-interaction-log";
import { createHarness, fixedFinanceClock, resetFinanceTestDatabase } from "./fixtures";
import { createTestPrisma } from "./test-prisma";

const prisma = createTestPrisma();
const tools = createFinanceToolRegistry(prisma, { clock: fixedFinanceClock });
const server = createFinanceMcpHttpServer({ createHandler: () => new FinanceMcpLifecycle(tools).handleMessage });
let endpoint = "";

async function call(body: unknown, sessionId?: string): Promise<Response> {
  return fetch(endpoint, { method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", ...(sessionId ? { "MCP-Session-Id": sessionId, "MCP-Protocol-Version": "2025-11-25" } : {}) }, body: JSON.stringify(body) });
}

async function session(): Promise<string> {
  const initialize = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "http-integration", version: "1.0.0" } } });
  const id = initialize.headers.get("mcp-session-id");
  if (!id) throw new Error("HTTP MCP session was not created");
  await call({ jsonrpc: "2.0", method: "notifications/initialized" }, id);
  return id;
}

beforeAll(async () => {
  await prisma.$connect();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
beforeEach(async () => resetFinanceTestDatabase(prisma));
afterAll(async () => { server.close(); await once(server, "close").catch(() => undefined); await prisma.$disconnect(); });

describe("Finance MCP Streamable HTTP with PostgreSQL", () => {
  it("lets the Host use the remote transport contract without exposing its MCP session", async () => {
    const logs = new InMemoryMcpInteractionLogStore();
    const client = await startFinanceMcpSession({
      config: { mode: "remote", endpoint: new URL(endpoint), timeoutMs: FINANCE_MCP_REMOTE_TIMEOUT_MS },
      interactionLogger: logs,
    });
    try {
      await expect(client.toolsList()).resolves.toMatchObject({ tools: expect.any(Array) });
      await expect(client.toolsCall("get_current_balance")).resolves.toMatchObject({ structuredContent: { currentBalance: "19475.00" } });
      const entries = logs.listBySession("HOST");
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ transport: "STREAMABLE_HTTP", method: "initialize", status: "SUCCEEDED" }),
        expect.objectContaining({ transport: "STREAMABLE_HTTP", method: "tools/list", status: "SUCCEEDED" }),
      ]));
      expect(JSON.stringify(entries)).not.toContain("MCP-Session-Id");
    } finally {
      await client.close();
    }
  });

  it("returns the same catalog and results as the local lifecycle", async () => {
    const id = await session();
    const listed = await call({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, id);
    const catalog = await listed.json() as { result: { tools: Array<{ name: string }> } };
    expect(catalog.result.tools).toHaveLength(30);
    const balance = await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_current_balance", arguments: {} } }, id);
    const remote = await balance.json() as { result: { structuredContent: { currentBalance: string } } };
    expect(remote.result.structuredContent.currentBalance).toBe("19475.00");
    const local = createHarness(prisma);
    await local.initialize();
    expect((await local.callTool("get_current_balance", {})).structuredContent?.currentBalance).toBe(remote.result.structuredContent.currentBalance);
  });

  it("persists calls, isolates sessions, and remains available after protocol errors", async () => {
    const first = await session();
    const mutation = await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "record_income", arguments: { accountId: 1, categoryId: 1, amount: "10.00", date: "2026-08-08" } } }, first);
    expect(mutation.status).toBe(200);
    expect(await prisma.transaction.count()).toBe(21);
    const second = await session();
    const invalid = await call({ jsonrpc: "2.0", id: 5, method: "unknown.method", params: {} }, second);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: -32601 } });
    await expect(call({ jsonrpc: "2.0", id: 6, method: "tools/list", params: {} }, second)).resolves.toMatchObject({ status: 200 });
    const deleted = await fetch(endpoint, { method: "DELETE", headers: { "MCP-Session-Id": first, "MCP-Protocol-Version": "2025-11-25" } });
    expect(deleted.status).toBe(204);
    await expect(call({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} }, first)).resolves.toMatchObject({ status: 404 });
  });
});
