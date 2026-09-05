import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatClient from "@/app/components/chat-client";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("ChatClient", () => {
  it("shows the empty state, sends one message, and retains the returned session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "completed", sessionId: "session-1", message: "## Hola\n\n¿En qué puedo ayudarte?" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatClient />);

    expect(screen.getByText("Escribe una pregunta para iniciar la conversación.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "Hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await screen.findByRole("heading", { level: 3, name: "Hola" });
    expect(screen.getByText("¿En qué puedo ayudarte?")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ body: JSON.stringify({ message: "Hola" }) }));
    expect(screen.getByText("Tú")).toBeTruthy();
    expect(screen.getByText("Asistente")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "Siguiente mensaje" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/chat", expect.objectContaining({ body: JSON.stringify({ sessionId: "session-1", message: "Siguiente mensaje" }) }));
  });

  it("uses Enter to submit, keeps Shift+Enter as a newline, and prevents duplicate sends while loading", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatClient />);
    const input = screen.getByLabelText("Mensaje");

    fireEvent.change(input, { target: { value: "Primero" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("status").textContent).toContain("Procesando tu solicitud…");
    expect(screen.getByText("El asistente está preparando la respuesta y puede consultar herramientas.")).toBeTruthy();
    expect(screen.getByTestId("chat-loading-skeleton").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("button", { name: "Procesando…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Espera mientras se completa la respuesta.")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveResponse?.(jsonResponse({ status: "completed", sessionId: "session-1", message: "Listo" }));
    await screen.findByText("Listo");
    fireEvent.change(input, { target: { value: "Una" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect((input as HTMLTextAreaElement).value).toBe("Una");
  });

  it("adds honest feedback after eight seconds and clears it with the response", async () => {
    vi.useFakeTimers();
    let resolveResponse: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; })));
    render(<ChatClient />);

    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "Consulta lenta" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(screen.queryByText("La solicitud sigue en curso. Algunas consultas pueden tardar más de lo habitual.")).toBeNull();

    act(() => { vi.advanceTimersByTime(8_000); });
    expect(screen.getByText("La solicitud sigue en curso. Algunas consultas pueden tardar más de lo habitual.")).toBeTruthy();

    await act(async () => {
      resolveResponse?.(jsonResponse({ status: "completed", sessionId: "session-1", message: "Respuesta lista" }));
      await Promise.resolve();
    });
    expect(screen.queryByText("Procesando tu solicitud…")).toBeNull();
    expect(screen.getByText("Respuesta lista")).toBeTruthy();
  });

  it("renders a safe error and clears an expired session for the next request", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "completed", sessionId: "expired", message: "Primera" }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "SESSION_NOT_FOUND", message: "La sesión ya no está disponible." }, sessionId: "expired" }, 404));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatClient />);
    const input = screen.getByLabelText("Mensaje");

    fireEvent.change(input, { target: { value: "uno" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("Primera");
    fireEvent.change(input, { target: { value: "dos" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("La sesión ya no está disponible.");
    expect(screen.queryByText("dos", { selector: ".messageUser p" })).toBeNull();
    expect((input as HTMLTextAreaElement).value).toBe("dos");
  });

  it("keeps a failed user message visible and preserves its draft after a recoverable send failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "CHAT_FAILED", message: "No fue posible completar la respuesta del chat." } }, 502)));
    render(<ChatClient />);
    const input = screen.getByLabelText("Mensaje");

    fireEvent.change(input, { target: { value: "Mantener este mensaje" } });
    fireEvent.submit(input.closest("form")!);

    await screen.findByRole("alert");
    expect(screen.getAllByText("Mantener este mensaje")).toHaveLength(2);
    expect(screen.getByText("No procesado.")).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe("Mantener este mensaje");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("keeps user messages and Host confirmation messages as literal text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      status: "confirmation_required",
      sessionId: "session-1",
      message: "¿Confirmas **esta** operación?",
      pendingOperation: { serverId: "finance-mcp", toolName: "record_income", arguments: {}, description: "Registrar ingreso" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatClient />);

    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "**sin formato**" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await screen.findByText("Registrar ingreso");
    expect(screen.queryByRole("strong", { name: "esta" })).toBeNull();
    expect(screen.getByText("**sin formato**").tagName).toBe("P");
  });

  it("shows explicit confirmation controls and sends only the decision", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "confirmation_required",
        sessionId: "session-1",
        message: "¿Confirmas esta operación?",
        pendingOperation: {
          serverId: "filesystem-mcp",
          toolName: "write_file",
          arguments: { path: "C:/safe/report.md", content: "<b>literal</b>" },
          description: "Escribir el reporte solicitado.",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", sessionId: "session-1", message: "Operación completada." }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatClient />);

    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "Escribe el reporte" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await screen.findByText("CONFIRMACIÓN REQUERIDA");
    expect(screen.getByText("Escribir el reporte solicitado.")).toBeTruthy();
    expect(screen.getByText("Filesystem MCP")).toBeTruthy();
    expect(screen.getByText("write_file")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirmar operación" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(screen.getByLabelText("Mensaje").hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar operación" }));
    await screen.findByText("Operación completada.");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/chat", expect.objectContaining({
      body: JSON.stringify({ sessionId: "session-1", confirmationDecision: "confirm" }),
    }));
    expect(screen.getByText("EJECUTADA")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirmar operación" })).toBeNull();
  });

  it("renders a complete batch preview with verified names and keeps IDs out of the preview", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      status: "confirmation_required",
      sessionId: "session-1",
      message: "Revisa el lote.",
      pendingOperation: {
        serverId: "finance-mcp",
        toolName: "record_transactions_batch",
        arguments: { type: "EXPENSE", transactions: [{ accountId: 1, categoryId: 2, amount: "100.00", date: "2026-08-10" }] },
        description: "Registrar 2 gastos en una sola operación.",
        preview: {
          kind: "transaction_batch",
          transactionType: "EXPENSE",
          currency: "GTQ",
          items: [
            { accountName: "Banco", categoryName: "Inventario", amount: "100.00", date: "2026-08-10", description: "Compra" },
            { accountName: "Efectivo", categoryName: "Servicios", amount: "200.00", date: "2026-08-11" },
          ],
        },
      },
    })));
    render(<ChatClient />);
    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "Registra gastos" } });
    fireEvent.submit(screen.getByLabelText("Mensaje").closest("form")!);

    await screen.findByText("Gastos que se registrarán en una sola operación");
    expect(screen.getByText("Banco")).toBeTruthy();
    expect(screen.getByText("Inventario")).toBeTruthy();
    expect(screen.getByText("GTQ 100.00")).toBeTruthy();
    expect(screen.getByRole("table").textContent).not.toContain("accountId");
  });

  it("cancels a pending operation without creating a user message", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "confirmation_required",
        sessionId: "session-1",
        message: "¿Confirmas esta operación?",
        pendingOperation: { serverId: "git-mcp", toolName: "git_add", arguments: { files: ["report.md"] }, description: "Agregar el reporte." },
      }))
      .mockResolvedValueOnce(jsonResponse({ status: "cancelled", sessionId: "session-1", message: "Operación cancelada." }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatClient />);

    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "Agrega el reporte" } });
    fireEvent.submit(screen.getByLabelText("Mensaje").closest("form")!);
    await screen.findByRole("button", { name: "Cancelar" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await screen.findByText("CANCELADA");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/chat", expect.objectContaining({
      body: JSON.stringify({ sessionId: "session-1", confirmationDecision: "cancel" }),
    }));
    expect(screen.queryByText("no", { selector: "p" })).toBeNull();
  });

  it("keeps the card visible and removes its controls when the Host no longer has the pending operation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "confirmation_required",
        sessionId: "session-1",
        message: "¿Confirmas esta operación?",
        pendingOperation: { serverId: "finance-mcp", toolName: "record_income", arguments: { amount: "1.00" }, description: "Registrar un ingreso." },
      }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "CONFIRMATION_NOT_FOUND", message: "La operación ya no está pendiente." }, sessionId: "session-1" }, 409));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatClient />);

    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "Registra un ingreso" } });
    fireEvent.submit(screen.getByLabelText("Mensaje").closest("form")!);
    await screen.findByRole("button", { name: "Confirmar operación" });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar operación" }));

    await screen.findByRole("alert");
    expect(screen.getByText("ESTADO NO DISPONIBLE")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirmar operación" })).toBeNull();
    expect(screen.getByLabelText("Mensaje").hasAttribute("disabled")).toBe(false);
  });

  it("reports the private session only to its parent callback", async () => {
    const onSessionIdChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "completed", sessionId: "session-1", message: "Listo" })));
    render(<ChatClient onSessionIdChange={onSessionIdChange} />);
    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByText("Listo");
    expect(onSessionIdChange).toHaveBeenCalledWith("session-1");
    expect(document.body.textContent).not.toContain("session-1");
  });
});
