import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatClient from "@/app/components/chat-client";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("ChatClient", () => {
  it("shows the empty state, sends one message, and retains the returned session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "completed", sessionId: "session-1", message: "Hola, ¿en qué puedo ayudarte?" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatClient />);

    expect(screen.getByText("Escribe una pregunta para iniciar la conversación.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "Hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await screen.findByText("Hola, ¿en qué puedo ayudarte?");
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
    expect(screen.getByText("Pensando…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enviar" }).hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveResponse?.(jsonResponse({ status: "completed", sessionId: "session-1", message: "Listo" }));
    await screen.findByText("Listo");
    fireEvent.change(input, { target: { value: "Una" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect((input as HTMLTextAreaElement).value).toBe("Una");
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
  });
});
