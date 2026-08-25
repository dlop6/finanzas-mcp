import { describe, expect, it, vi } from "vitest";
import { createFinancialReportDemo } from "@/host/demo";
import type { SessionChatService } from "@/host/context";
import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";

const root = process.cwd();
const repo = `${root}\\docs\\generated\\git-demo`;
const markdown = "# Financial Report\n\n## Current Balance\n## Accounts\n## Pending Debts\n## Pending Receivables\n## Low Stock Products\n";

function completed(content: string, calls: string[] = []) {
  return {
    status: "completed" as const,
    response: { content, toolCalls: [], model: "test", finishReason: "stop" },
    turnMessages: [
      { role: "user" as const, content: "request" },
      { role: "assistant" as const, content: calls.length ? null : content, ...(calls.length ? { toolCalls: calls.map((name, index) => ({ id: `call-${index}`, type: "function" as const, function: { name, arguments: "{}" } })) } : {}) },
      ...(calls.length ? calls.map((_, index) => ({ role: "tool" as const, toolCallId: `call-${index}`, content: "{}" })) : []),
      ...(calls.length ? [{ role: "assistant" as const, content }] : []),
    ],
  };
}

function pending(serverId: string, toolName: string, args: Record<string, unknown>) {
  return {
    status: "confirmation_required" as const,
    pendingOperation: { toolCallId: `${toolName}-id`, serverId, toolName, arguments: args, description: toolName },
    message: `Confirm ${toolName}`,
  };
}

function mockRegistry(): HostMcpToolRegistry {
  const tools = Array.from({ length: 50 }, (_, index) => ({
    serverId: index < 24 ? "finance-mcp" : index < 38 ? "filesystem-mcp" : "git-mcp",
    definition: { name: `tool_${index}`, description: "tool", inputSchema: {} },
    isWriteOperation: index < 24 ? index < 15 : index < 38 ? index < 28 : index < 43,
    client: {} as never,
  }));
  return { list: () => structuredClone(tools) } as unknown as HostMcpToolRegistry;
}

describe("local Finance Filesystem Git E2E demo", () => {
  it("uses the exact report, staging and commit operations after three confirmations", async () => {
    const mark = "20260824T120000Z";
    const reportPath = `${repo}\\financial-report-${mark}.md`;
    const commitMessage = `docs: add financial report ${mark}`;
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(completed(markdown, ["get_current_balance", "list_debts", "list_receivables", "list_low_stock_products"]))
      .mockResolvedValueOnce(pending("filesystem-mcp", "write_file", { path: reportPath, content: markdown }))
      .mockResolvedValueOnce(completed("Saved."))
      .mockResolvedValueOnce(pending("git-mcp", "git_add", { repo_path: repo, files: [`financial-report-${mark}.md`] }))
      .mockResolvedValueOnce(completed("Staged."))
      .mockResolvedValueOnce(pending("git-mcp", "git_commit", { repo_path: repo, message: commitMessage }))
      .mockResolvedValueOnce(completed("Committed."));
    const chat = { createSession: () => ({ sessionId: "session-1" }), sendMessage } as unknown as SessionChatService;
    const filesystemClient = { toolsCall: vi.fn(async (name: string) => name === "list_allowed_directories" ? { content: [{ type: "text", text: `${root}\\docs\\generated` }] } : { content: [{ type: "text", text: markdown }] }) };
    let stagedCalls = 0;
    let logCalls = 0;
    const gitClient = { toolsCall: vi.fn(async (name: string) => {
      if (name === "git_log") {
        logCalls += 1;
        return { content: [{ type: "text", text: logCalls === 1 ? "chore: baseline" : commitMessage }] };
      }
      if (name === "git_diff_staged") {
        stagedCalls += 1;
        return { content: [{ type: "text", text: stagedCalls === 1 ? "" : `financial-report-${mark}.md` }] };
      }
      return { content: [{ type: "text", text: "working tree clean" }] };
    }) };
    const console = { write: vi.fn(), read: vi.fn().mockResolvedValue("sí") };
    const demo = createFinancialReportDemo({ sessionChat: chat, registry: mockRegistry(), filesystemClient: filesystemClient as never, gitClient: gitClient as never, interactionLogs: { listBySession: () => [] }, projectRoot: root, clock: { now: () => new Date("2026-08-24T12:00:00Z") }, console });

    await expect(demo.run()).resolves.toEqual({ status: "completed", sessionId: "session-1", reportPath, commitMessage });
    expect(sendMessage).toHaveBeenCalledTimes(7);
    expect(filesystemClient.toolsCall).toHaveBeenCalledWith("read_text_file", { path: reportPath }, { sessionId: "session-1" });
    expect(gitClient.toolsCall).toHaveBeenCalledWith("git_status", { repo_path: repo });
  });

  it("stops after a cancelled write without requesting Git", async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(completed(markdown, ["get_current_balance", "list_debts", "list_receivables", "list_low_stock_products"]))
      .mockResolvedValueOnce(pending("filesystem-mcp", "write_file", { path: `${repo}\\financial-report-20260824T120000Z.md`, content: markdown }))
      .mockResolvedValueOnce({ status: "cancelled" as const, message: "cancelled" });
    const gitClient = { toolsCall: vi.fn(async () => ({ content: [{ type: "text", text: "working tree clean" }] })) };
    const demo = createFinancialReportDemo({
      sessionChat: { createSession: () => ({ sessionId: "session-2" }), sendMessage } as unknown as SessionChatService,
      registry: mockRegistry(),
      filesystemClient: { toolsCall: vi.fn(async () => ({ content: [{ type: "text", text: `${root}\\docs\\generated` }] })) } as never,
      gitClient: gitClient as never,
      interactionLogs: { listBySession: () => [] }, projectRoot: root, clock: { now: () => new Date("2026-08-24T12:00:00Z") }, console: { write: vi.fn(), read: vi.fn().mockResolvedValue("no") },
    });
    await expect(demo.run()).resolves.toEqual({ status: "cancelled", sessionId: "session-2", cancelledStep: "write_file" });
    expect(gitClient.toolsCall).toHaveBeenCalledTimes(1);
  });
});
