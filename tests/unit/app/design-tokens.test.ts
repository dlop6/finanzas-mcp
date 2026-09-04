import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("neobrutalist contrast tokens", () => {
  it("defines the accessible teal surface pair", () => {
    const globals = read("app/globals.css");

    expect(globals).toContain("--nb-teal: #00695c;");
    expect(globals).toContain("--nb-on-teal: #ffffff;");
  });

  it("uses the on-teal token on filled teal surfaces", () => {
    const styles = [
      read("app/components/workspace.module.css"),
      read("app/components/financial-dashboard.module.css"),
      read("app/components/chat-client.module.css"),
      read("app/components/mcp-logs-panel.module.css"),
    ].join("\n");

    expect(styles.match(/color:\s*var\(--nb-on-teal\)/g)?.length).toBeGreaterThanOrEqual(7);
  });
});
