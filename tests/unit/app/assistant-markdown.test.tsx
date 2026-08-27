import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AssistantMarkdown from "@/app/components/assistant-markdown";

afterEach(cleanup);

describe("AssistantMarkdown", () => {
  it("renders CommonMark and GFM content with accessible structure", () => {
    const { container } = render(
      <AssistantMarkdown content={[
        "# Resumen",
        "",
        "- **Saldo**: `GTQ 100.00`",
        "- ~~pendiente~~",
        "",
        "| Cuenta | Saldo |",
        "| --- | ---: |",
        "| Caja | 100.00 |",
        "",
        "- [x] Revisado",
      ].join("\n")} />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Resumen" })).toBeTruthy();
    expect(screen.getByText("Saldo", { selector: "strong" }).tagName).toBe("STRONG");
    expect(screen.getByText("GTQ 100.00").tagName).toBe("CODE");
    expect(screen.getByText("pendiente").tagName).toBe("DEL");
    expect(screen.getByRole("table")).toBeTruthy();
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox?.disabled).toBe(true);
    expect(checkbox?.checked).toBe(true);
  });

  it("blocks raw HTML, unsafe links, and remote images", () => {
    const { container, rerender } = render(<AssistantMarkdown content="<script>window.evil = true</script>" />);

    expect(container.querySelector("script")).toBeNull();
    rerender(<AssistantMarkdown content="[inseguro](javascript:alert(1)) ![Diagrama](https://example.com/diagram.png)" />);
    expect(screen.queryByRole("link", { name: "inseguro" })).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("note").textContent).toBe("Imagen externa omitida: Diagrama");
  });

  it("opens safe external links with protective attributes", () => {
    render(<AssistantMarkdown content="[Documentación](https://example.com/docs)" />);

    const link = screen.getByRole("link", { name: "Documentación" });
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });
});
