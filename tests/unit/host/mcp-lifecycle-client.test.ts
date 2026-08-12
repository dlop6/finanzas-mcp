import { describe, expect, it } from "vitest";
import { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";

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
    expect(client.state).toBe("DISCONNECTED");
  });

  it("closes on an invalid initialize response", async () => {
    const client = new McpLifecycleClient(transportStub({}) as never);

    await expect(client.initialize()).rejects.toMatchObject({
      code: "PROTOCOL_ERROR",
    });
    expect(client.state).toBe("CLOSED");
  });
});
