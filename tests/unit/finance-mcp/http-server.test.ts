import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { FinanceMcpLifecycle } from "@/servers/finance-mcp/lifecycle";
import { createFinanceMcpHttpServer, FINANCE_MCP_HTTP_PATH, loadFinanceMcpHttpConfig } from "@/servers/finance-mcp/http-server";

const servers: ReturnType<typeof createFinanceMcpHttpServer>[] = [];

async function startServer() {
  const server = createFinanceMcpHttpServer({ createHandler: () => new FinanceMcpLifecycle().handleMessage });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}${FINANCE_MCP_HTTP_PATH}`;
}

async function post(url: string, body: unknown, sessionId?: string, extraHeaders: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(sessionId ? { "MCP-Session-Id": sessionId, "MCP-Protocol-Version": "2025-11-25" } : {}),
      ...extraHeaders,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function initializeRequest(id = 1) {
  return { jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "http-test", version: "1.0.0" } } };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.close();
    await once(server, "close").catch(() => undefined);
  }));
});

describe("Finance MCP Streamable HTTP transport", () => {
  it("creates an MCP session and enforces its lifecycle", async () => {
    const url = await startServer();
    const initialized = await post(url, initializeRequest());
    expect(initialized.status).toBe(200);
    const sessionId = initialized.headers.get("mcp-session-id");
    expect(sessionId).toMatch(/^[\x21-\x7e]+$/);
    await expect(initialized.json()).resolves.toMatchObject({ id: 1, result: { protocolVersion: "2025-11-25" } });

    await expect(post(url, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId!)).resolves.toMatchObject({ status: 202 });
    const tools = await post(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId!);
    await expect(tools.json()).resolves.toEqual({ jsonrpc: "2.0", id: 2, result: { tools: [] } });
  });

  it("rejects malformed, unsafe, and unknown session traffic without stopping", async () => {
    const url = await startServer();
    await expect(post(url, "{", undefined)).resolves.toMatchObject({ status: 400 });
    await expect(post(url, initializeRequest(), undefined, { Origin: "https://unexpected.example" })).resolves.toMatchObject({ status: 403 });
    await expect(post(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, "unknown")).resolves.toMatchObject({ status: 404 });
    await expect(fetch(url, { method: "GET" })).resolves.toMatchObject({ status: 405 });
    await expect(post(url, initializeRequest(3))).resolves.toMatchObject({ status: 200 });
  });

  it("validates HTTP negotiation before dispatching a message", async () => {
    const url = await startServer();
    await expect(fetch(url, { method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "text/plain" }, body: "{}" })).resolves.toMatchObject({ status: 415 });
    await expect(fetch(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: "{}" })).resolves.toMatchObject({ status: 406 });
    const initialized = await post(url, initializeRequest());
    const sessionId = initialized.headers.get("mcp-session-id")!;
    const noVersion = await fetch(url, { method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Session-Id": sessionId }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) });
    await expect(noVersion.json()).resolves.toMatchObject({ error: { code: -32600 } });
  });

  it("deletes sessions and validates configuration without exposing values", async () => {
    expect(loadFinanceMcpHttpConfig({})).toEqual({ host: "127.0.0.1", port: 3001, allowedOrigins: [] });
    expect(() => loadFinanceMcpHttpConfig({ PORT: "not-a-port" })).toThrow("valid TCP port");
    const url = await startServer();
    const initialized = await post(url, initializeRequest());
    const sessionId = initialized.headers.get("mcp-session-id")!;
    const deleted = await fetch(url, { method: "DELETE", headers: { "MCP-Session-Id": sessionId, "MCP-Protocol-Version": "2025-11-25" } });
    expect(deleted.status).toBe(204);
    await expect(post(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId)).resolves.toMatchObject({ status: 404 });
  });
});
