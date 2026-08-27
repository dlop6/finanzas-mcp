import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const clientSource = readFileSync(resolve(process.cwd(), "app/components/chat-client.tsx"), "utf8");

describe("Web chat client boundary", () => {
  it("does not import Host, MCP, LLM, Prisma, or database modules", () => {
    expect(clientSource).not.toMatch(/from\s+["']@\/host(?:\/|["'])/);
    expect(clientSource).not.toMatch(/(?:DeepSeek|Prisma|McpLifecycleClient|toolsCall)/);
  });

  it("keeps browser session state in the component instead of browser storage", () => {
    expect(clientSource).toContain('useState<string | null>(null)');
    expect(clientSource).not.toMatch(/(?:localStorage|sessionStorage|document\.cookie)/);
  });
});
