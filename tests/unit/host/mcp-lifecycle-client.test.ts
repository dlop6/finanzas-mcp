import { describe, expect, it, vi } from "vitest";
import { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
import { HOST_MCP_LOG_SESSION_ID } from "@/host/mcp-clients/mcp-interaction-log";
import { MCP_PROTOCOL_VERSION } from "@/shared/mcp";

function transportStub(result: unknown) {
  return {
    request: async () => result,
    notify: async () => undefined,
    close: async () => undefined,
  };
}

describe("MCP lifecycle client", () => {
  it("blocks tool operations until initialization completes", async () => {
    const client = new McpLifecycleClient(transportStub({}) as never);

    await expect(client.toolsList()).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(client.toolsCall("test.echo")).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect(client.state).toBe("DISCONNECTED");
  });

  it("closes on an invalid initialize response", async () => {
    const client = new McpLifecycleClient(transportStub({}) as never);

    await expect(client.initialize()).rejects.toMatchObject({
      code: "PROTOCOL_ERROR",
    });
    expect(client.state).toBe("CLOSED");
  });

  it("closes when a ready session receives an invalid tool result", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "test", version: "1" },
      })
      .mockResolvedValueOnce({ tools: "invalid" });
    const close = vi.fn().mockResolvedValue(undefined);
    const client = new McpLifecycleClient({ request, notify: vi.fn(), close } as never);

    await client.initialize();
    await expect(client.toolsList()).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(client.state).toBe("CLOSED");
    expect(close).toHaveBeenCalledOnce();
  });

  it("uses the reserved HOST session for lifecycle and discovery traffic", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "test", version: "1" },
      })
      .mockResolvedValueOnce({ tools: [] });
    const notify = vi.fn().mockResolvedValue(undefined);
    const client = new McpLifecycleClient({ request, notify, close: vi.fn() } as never);

    await client.initialize();
    await client.toolsList();

    expect(request.mock.calls[0][2]).toEqual({ sessionId: HOST_MCP_LOG_SESSION_ID });
    expect(notify.mock.calls[0][2]).toEqual({ sessionId: HOST_MCP_LOG_SESSION_ID });
    expect(request.mock.calls[1][2]).toEqual({ sessionId: HOST_MCP_LOG_SESSION_ID });
  });
});
