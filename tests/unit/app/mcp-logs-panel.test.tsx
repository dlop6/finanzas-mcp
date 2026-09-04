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
      durationMs: 0,
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
      durationMs: 5051.248100000001,
    }],
  }],
} as const;

describe("McpLogsPanel", () => {
  it("loads approved logs, keeps normal payloads collapsed, and expands errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<McpLogsPanel chatSessionId={null} active />);

    await screen.findByText("Lifecycle y discovery");
    expect(screen.getByRole("table", { name: "Eventos de Lifecycle y discovery" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Hora", "Evento", "Resultado"]);
    expect(screen.getByText("Host → MCP")).toBeTruthy();
    expect(screen.getAllByText("Request ID: 0")).toHaveLength(2);
    expect(screen.getAllByText("Enviado")).toHaveLength(1);
    expect(screen.getAllByText("Error de protocolo")).toHaveLength(1);
    expect(screen.getByText("0 ms")).toBeTruthy();
    expect(screen.getByText("5,051.2 ms")).toBeTruthy();
    const payloadButtons = screen.getAllByRole("button", { name: /payload de initialize/i });
    expect(payloadButtons[0].getAttribute("aria-expanded")).toBe("false");
    expect(payloadButtons[1].getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText("<script>window.bad=true</script>")).toBeNull();
    expect(screen.getByText('{"error":"safe"}').tagName).toBe("CODE");
    expect(document.querySelector("script")).toBeNull();

    fireEvent.click(payloadButtons[0]);
    expect(payloadButtons[0].getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("<script>window.bad=true</script>").tagName).toBe("CODE");
    fireEvent.click(payloadButtons[0]);
    expect(payloadButtons[0].getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("<script>window.bad=true</script>")).toBeNull();
  });

  it("filters locally and refreshes without duplicate requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<McpLogsPanel chatSessionId={null} active />);
    await screen.findByText("Lifecycle y discovery");
    fireEvent.change(screen.getByLabelText("Tipo de mensaje"), { target: { value: "error" } });
    expect(screen.queryByText("Host → MCP")).toBeNull();
    expect(screen.getByText("MCP → Host")).toBeTruthy();
    const errorPayload = screen.getByRole("button", { name: /ocultar payload de initialize/i });
    fireEvent.click(errorPayload);
    expect(errorPayload.getAttribute("aria-expanded")).toBe("false");
    const refresh = screen.getByRole("button", { name: "Actualizar" });
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(errorPayload.getAttribute("aria-expanded")).toBe("false");
  });

  it("distinguishes filters without matches from an empty log context", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 })));
    render(<McpLogsPanel chatSessionId={null} active />);
    await screen.findByText("Lifecycle y discovery");

    fireEvent.change(screen.getByLabelText("Servidor"), { target: { value: "git-mcp" } });
    expect(screen.getByText("No hay eventos que coincidan con los filtros seleccionados.")).toBeTruthy();
  });

  it("announces a refresh while retaining visible log entries", async () => {
    let resolveRefresh: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveRefresh = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<McpLogsPanel chatSessionId={null} active />);
    await screen.findByText("Lifecycle y discovery");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    expect(screen.getByRole("status").textContent).toContain("Actualizando logs MCP");
    expect(screen.getByText("Lifecycle y discovery")).toBeTruthy();
    resolveRefresh?.(new Response(JSON.stringify(response), { status: 200 }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Logs MCP actualizados"));
  });
});
