import { describe, expect, it, vi } from "vitest";
import { type RemoteMcpProbeFetch, RemoteMcpProbeError, runRemoteMcpProbe } from "../../../scripts/wireshark/remote-mcp-probe";

const endpoint = "https://finanzas-mcp-server.onrender.com/mcp";
const sessionHeaders = { "mcp-session-id": "test-session" };

function response(body: object, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("remote MCP Wireshark probe", () => {
  it("runs the read-only lifecycle and closes the session", async () => {
    const request = vi.fn<RemoteMcpProbeFetch>()
      .mockResolvedValueOnce(response({ jsonrpc: "2.0", id: 1, result: {} }, 200, sessionHeaders))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(response({ jsonrpc: "2.0", id: 2, result: { tools: Array.from({ length: 25 }, () => ({})) } }))
      .mockResolvedValueOnce(response({ jsonrpc: "2.0", id: 3, result: { content: [], structuredContent: { currentBalance: "19475.00" } } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(runRemoteMcpProbe(endpoint, request)).resolves.toBeUndefined();
    expect(request.mock.calls.map(([, options]) => options?.method)).toEqual(["POST", "POST", "POST", "POST", "DELETE"]);
    expect(String(request.mock.calls[3]?.[1]?.body)).toContain("get_current_balance");
    expect(String(request.mock.calls[3]?.[1]?.body)).not.toContain("record_income");
  });

  it("rejects invalid endpoints before requesting or capturing traffic", async () => {
    const request = vi.fn();
    await expect(runRemoteMcpProbe("http://localhost:3001/mcp", request)).rejects.toMatchObject({ code: "INVALID_ENDPOINT" } satisfies Partial<RemoteMcpProbeError>);
    expect(request).not.toHaveBeenCalled();
  });

  it("closes an acquired session when discovery is invalid", async () => {
    const request = vi.fn<RemoteMcpProbeFetch>()
      .mockResolvedValueOnce(response({ jsonrpc: "2.0", id: 1, result: {} }, 200, sessionHeaders))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(response({ jsonrpc: "2.0", id: 2, result: { tools: [] } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(runRemoteMcpProbe(endpoint, request)).rejects.toMatchObject({ code: "INVALID_RESPONSE" } satisfies Partial<RemoteMcpProbeError>);
    expect(request.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });
});
