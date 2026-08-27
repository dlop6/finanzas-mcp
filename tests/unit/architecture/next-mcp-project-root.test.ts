import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const bundledMcpFactories = [
  "host/mcp-clients/finance-mcp-local.ts",
  "host/mcp-clients/filesystem-mcp-local.ts",
  "host/mcp-clients/git-mcp-local.ts",
];

describe("Next.js MCP process roots", () => {
  it("does not derive project paths from import.meta.url because Turbopack relocates server modules", () => {
    for (const path of bundledMcpFactories) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source, path).not.toContain("fileURLToPath(import.meta.url)");
    }
  });
});
