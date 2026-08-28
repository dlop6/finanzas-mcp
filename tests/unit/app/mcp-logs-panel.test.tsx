import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import McpLogsPanel from "@/app/components/mcp-logs-panel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const response = {
  status: "ready",
  generatedAt: "2026-08-30T18:00:00.000Z",
  groups: [{
    context: "HOST",
    label: "Lifecycle y discovery",
    entries: [{
      timestamp: "2026-08-30T18:00:00.000Z",
      context: "HOST",
      serverId: "finance-mcp",
      transport: "STREAMABLE_HTTP",
      direction: "HOST_TO_MCP",
      messageType: "request",
      method: "initialize",
      requestId: 0,
      payload: '<script>window.bad=true</script>',
      status: "SENT",
    }, {
      timestamp: "2026-08-30T18:00:00.100Z",
      context: "HOST",
      serverId: "finance-mcp",
      transport: "STREAMABLE_HTTP",
      direction: "MCP_TO_HOST",
      messageType: "error",
      method: "initialize",
      requestId: 0,
      payload: '{"error":"safe"}',
      status: "PROTOCOL_ERROR",
      durationMs: 0,
    }],
  }],
} as const;

describe("McpLogsPanel", () => {
  it("loads approved logs, keeps normal payloads collapsed, and expands errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<McpLogsPanel chatSessionId={null} active />);

    await screen.findByText("Lifecycle y discovery");
    expect(screen.getByText("Host → MCP")).toBeTruthy();
    expect(screen.getAllByText("Request ID: 0")).toHaveLength(2);
    const details = screen.getAllByText("Ver payload JSON-RPC").map((item) => item.closest("details")!);
    expect(details[0].open).toBe(false);
    expect(details[1].open).toBe(true);
    expect(screen.getByText("<script>window.bad=true</script>").tagName).toBe("CODE");
    expect(document.querySelector("script")).toBeNull();
  });

  it("filters locally and refreshes without duplicate requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<McpLogsPanel chatSessionId={null} active />);
    await screen.findByText("Lifecycle y discovery");
    fireEvent.change(screen.getByLabelText("Tipo de mensaje"), { target: { value: "error" } });
    expect(screen.queryByText("Host → MCP")).toBeNull();
    expect(screen.getByText("MCP → Host")).toBeTruthy();
    const refresh = screen.getByRole("button", { name: "Actualizar" });
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
