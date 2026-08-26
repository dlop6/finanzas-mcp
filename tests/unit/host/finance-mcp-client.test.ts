import { describe, expect, it, vi } from "vitest";
import { MCP_PROTOCOL_VERSION } from "@/shared/mcp";
import { InMemoryMcpInteractionLogStore } from "@/host/mcp-clients/mcp-interaction-log";
import {
  FINANCE_MCP_REMOTE_TIMEOUT_MS,
  FinanceMcpClientConfigurationError,
  loadFinanceMcpClientConfig,
  startFinanceMcpSession,
} from "@/host/mcp-clients/finance-mcp-client";
import {
  StreamableHttpJsonRpcClient,
  StreamableHttpTransportError,
} from "@/host/mcp-clients/streamable-http-jsonrpc-client";

const initializeResult = {
  jsonrpc: "2.0" as const,
  id: 1,
  result: {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: "finance-mcp", version: "0.1.0" },
  },
};

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("Finance MCP mode configuration", () => {
  it("defaults to local and ignores an unused remote URL", () => {
    expect(loadFinanceMcpClientConfig({ FINANCE_MCP_REMOTE_URL: "not a URL" })).toEqual({ mode: "local" });
    expect(loadFinanceMcpClientConfig({ FINANCE_MCP_MODE: " local " })).toEqual({ mode: "local" });
  });

  it("loads a remote HTTPS endpoint with the fixed timeout", () => {
    const result = loadFinanceMcpClientConfig({
      FINANCE_MCP_MODE: "remote",
      FINANCE_MCP_REMOTE_URL: "https://finanzas-mcp-server.onrender.com/mcp",
    });

    expect(result).toMatchObject({ mode: "remote", timeoutMs: FINANCE_MCP_REMOTE_TIMEOUT_MS });
    expect(result.mode === "remote" && result.endpoint.href).toBe("https://finanzas-mcp-server.onrender.com/mcp");
  });

  it.each([
    { FINANCE_MCP_MODE: "other" },
    { FINANCE_MCP_MODE: "remote" },
    { FINANCE_MCP_MODE: "remote", FINANCE_MCP_REMOTE_URL: "http://example.test/mcp" },
    { FINANCE_MCP_MODE: "remote", FINANCE_MCP_REMOTE_URL: "https://example.test/other" },
    { FINANCE_MCP_MODE: "remote", FINANCE_MCP_REMOTE_URL: "https://user:pass@example.test/mcp" },
    { FINANCE_MCP_MODE: "remote", FINANCE_MCP_REMOTE_URL: "https://example.test/mcp?x=1" },
  ])("rejects invalid remote configuration safely", (environment) => {
    const error = (() => {
      try { loadFinanceMcpClientConfig(environment); } catch (value) { return value; }
      return undefined;
    })();
    expect(error).toBeInstanceOf(FinanceMcpClientConfigurationError);
    expect((error as Error).message).not.toContain("user:pass");
  });
});

describe("Streamable HTTP JSON-RPC transport", () => {
  it("keeps the MCP session private while sending lifecycle and tool traffic", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(initializeResult, 200, { "MCP-Session-Id": "private-session" }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 2, result: { tools: [] } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const logs = new InMemoryMcpInteractionLogStore();
    const client = new StreamableHttpJsonRpcClient({
      endpoint: new URL("http://127.0.0.1:3001/mcp"),
      fetchImpl,
      interactionLogger: logs,
    });
    await client.start();

    await client.request("initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test", version: "1" } });
    await client.notify("notifications/initialized");
    await expect(client.request("tools/list", {})).resolves.toEqual({ tools: [] });
    await client.close();

    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get("MCP-Session-Id")).toBeNull();
    expect(new Headers(fetchImpl.mock.calls[1][1]?.headers).get("MCP-Session-Id")).toBe("private-session");
    expect(new Headers(fetchImpl.mock.calls[1][1]?.headers).get("MCP-Protocol-Version")).toBe(MCP_PROTOCOL_VERSION);
    expect(fetchImpl.mock.calls[3][1]).toMatchObject({ method: "DELETE" });
    expect(logs.listBySession("HOST")).toEqual(expect.arrayContaining([
      expect.objectContaining({ transport: "STREAMABLE_HTTP", method: "initialize", status: "SENT" }),
      expect.objectContaining({ transport: "STREAMABLE_HTTP", method: "tools/list", status: "SUCCEEDED" }),
    ]));
    expect(JSON.stringify(logs.listBySession("HOST"))).not.toContain("private-session");
  });

  it("fails without fallback on invalid responses, HTTP errors, or timeouts", async () => {
    const invalid = new StreamableHttpJsonRpcClient({
      endpoint: new URL("http://127.0.0.1:3001/mcp"),
      fetchImpl: vi.fn(async () => jsonResponse({ jsonrpc: "2.0", id: 9, result: {} }, 200, { "MCP-Session-Id": "session" })),
    });
    await invalid.start();
    await expect(invalid.request("initialize", {})).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });

    const failure = new StreamableHttpJsonRpcClient({
      endpoint: new URL("http://127.0.0.1:3001/mcp"),
      fetchImpl: vi.fn(async () => new Response(null, { status: 503 })),
    });
    await failure.start();
    await expect(failure.request("initialize", {})).rejects.toBeInstanceOf(StreamableHttpTransportError);
  });

  it("aborts a timed-out request without retrying", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
      const client = new StreamableHttpJsonRpcClient({ endpoint: new URL("http://127.0.0.1:3001/mcp"), fetchImpl, timeoutMs: 10 });
      await client.start();
      const pending = client.request("initialize", {});
      const rejection = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
      await vi.advanceTimersByTimeAsync(10);
      await rejection;
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects only the configured remote transport", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(initializeResult, 200, { "MCP-Session-Id": "private-session" }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = await startFinanceMcpSession({
      config: { mode: "remote", endpoint: new URL("http://127.0.0.1:3001/mcp"), timeoutMs: FINANCE_MCP_REMOTE_TIMEOUT_MS },
      fetchImpl,
    });
    await client.close();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2][1]).toMatchObject({ method: "DELETE" });
  });
});
