import { describe, expect, it, vi } from "vitest";
import { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
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
});
