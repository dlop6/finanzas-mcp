import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionChatService } from "@/host/context/session-chat-service";
import { InMemoryConversationSessionStore } from "@/host/context/conversation-session-store";
import { InMemoryMcpInteractionLogStore, HOST_MCP_LOG_SESSION_ID } from "@/host/mcp-clients/mcp-interaction-log";
import { gitMcpPythonPath, startGitMcpSessionLocal } from "@/host/mcp-clients/git-mcp-local";
import { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
import { StdioJsonRpcClient } from "@/host/mcp-clients/stdio-jsonrpc-client";
import { createChatOrchestrator } from "@/host/orchestration/chat-orchestrator";
import { registerGitMcpTools } from "@/host/orchestration/git-mcp-tools";
import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";

const execute = promisify(execFile);
const projectRoot = process.cwd();
const sessions: McpLifecycleClient[] = [];

function systemEnvironment(): NodeJS.ProcessEnv {
  const keys = process.platform === "win32"
    ? ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP"]
    : ["PATH", "TMPDIR", "LANG", "LC_ALL"];
  return Object.fromEntries(keys.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]])) as NodeJS.ProcessEnv;
}

async function initializeRepository(repository: string): Promise<void> {
  await execute("git", ["init", "-b", "main"], { cwd: repository });
  await execute("git", ["config", "user.name", "Git MCP Test"], { cwd: repository });
  await execute("git", ["config", "user.email", "git-mcp-test@local.invalid"], { cwd: repository });
  await execute("git", ["commit", "--allow-empty", "-m", "chore: baseline"], { cwd: repository });
}

async function startTemporaryGitMcp(repository: string, logs: InMemoryMcpInteractionLogStore): Promise<McpLifecycleClient> {
  await access(gitMcpPythonPath(projectRoot));
  const transport = new StdioJsonRpcClient({
    command: gitMcpPythonPath(projectRoot),
    args: ["-m", "mcp_server_git", "--repository", repository],
    cwd: projectRoot,
    env: systemEnvironment(),
    onStderr: () => undefined,
    serverId: "git-mcp",
    interactionLogger: logs,
  });
  await transport.start();
  const session = new McpLifecycleClient(transport);
  await session.initialize();
  sessions.push(session);
  return session;
}

afterEach(async () => {
  await Promise.allSettled(sessions.splice(0).map((session) => session.close()));
});

describe("official Git MCP integration", () => {
  it("starts the controlled local server, discovers its 12 tools, and rejects the project repository", async () => {
    const logs = new InMemoryMcpInteractionLogStore();
    const session = await startGitMcpSessionLocal({ onStderr: () => undefined, interactionLogger: logs });
    sessions.push(session);

    const tools = await session.toolsList();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "git_status", "git_diff_unstaged", "git_diff_staged", "git_diff", "git_commit", "git_add", "git_reset",
      "git_log", "git_create_branch", "git_checkout", "git_show", "git_branch",
    ]);
    await expect(session.toolsCall("git_status", { repo_path: resolve(projectRoot, "docs/generated/git-demo") })).resolves.toMatchObject({ content: [{ type: "text" }] });
    await expect(session.toolsCall("git_status", { repo_path: projectRoot })).resolves.toMatchObject({ isError: true });
    expect(logs.listBySession(HOST_MCP_LOG_SESSION_ID)).toContainEqual(expect.objectContaining({ serverId: "git-mcp", method: "tools/list" }));
  }, 30_000);

  it("stages and commits exactly once only after separate confirmations", async () => {
    const repository = await mkdtemp(join(tmpdir(), "finance-mcp-git-"));
    const logs = new InMemoryMcpInteractionLogStore();
    await initializeRepository(repository);
    await writeFile(join(repository, "report.md"), "# Generated report\n", "utf8");
    const mcp = await startTemporaryGitMcp(repository, logs);
    const registry = new HostMcpToolRegistry();
    await registerGitMcpTools(registry, { toolsList: mcp.toolsList.bind(mcp), toolsCall: mcp.toolsCall.bind(mcp) });
    const sendChat = vi.fn()
      .mockResolvedValueOnce({ content: null, toolCalls: [{ id: "add-1", type: "function", function: { name: "git_add", arguments: JSON.stringify({ repo_path: repository, files: ["report.md"] }) } }], model: "test", finishReason: "tool_calls" })
      .mockResolvedValueOnce({ content: "The file was staged.", toolCalls: [], model: "test", finishReason: "stop" })
      .mockResolvedValueOnce({ content: null, toolCalls: [{ id: "commit-1", type: "function", function: { name: "git_commit", arguments: JSON.stringify({ repo_path: repository, message: "docs: add generated report" }) } }], model: "test", finishReason: "tool_calls" })
      .mockResolvedValueOnce({ content: "The report was committed.", toolCalls: [], model: "test", finishReason: "stop" });
    const chat = createSessionChatService({
      sessionStore: new InMemoryConversationSessionStore({ idGenerator: () => "git-session" }),
      chatOrchestrator: createChatOrchestrator({ deepSeekClient: { sendChat }, toolRegistry: registry }),
      contextCompactor: { compactIfNeeded: async (input) => ({ compacted: false, conversationSummary: input.conversationSummary, messages: Array.from(structuredClone(input.messages)) }) },
    });
    const conversation = chat.createSession({ systemPrompt: "Use only the registered Git tools." });

    try {
      await expect(chat.sendMessage(conversation.sessionId, "Stage the report.")).resolves.toMatchObject({ status: "confirmation_required", pendingOperation: { toolName: "git_add" } });
      await expect(execute("git", ["diff", "--cached", "--name-only"], { cwd: repository })).resolves.toMatchObject({ stdout: "" });
      await expect(chat.sendMessage(conversation.sessionId, "sí")).resolves.toMatchObject({ status: "completed" });
      await expect(execute("git", ["diff", "--cached", "--name-only"], { cwd: repository })).resolves.toMatchObject({ stdout: "report.md\n" });
      await expect(chat.sendMessage(conversation.sessionId, "Commit the staged report.")).resolves.toMatchObject({ status: "confirmation_required", pendingOperation: { toolName: "git_commit" } });
      await expect(execute("git", ["log", "-1", "--format=%s"], { cwd: repository })).resolves.toMatchObject({ stdout: "chore: baseline\n" });
      await expect(chat.sendMessage(conversation.sessionId, "confirmo")).resolves.toMatchObject({ status: "completed" });
      await expect(execute("git", ["log", "-1", "--format=%s"], { cwd: repository })).resolves.toMatchObject({ stdout: "docs: add generated report\n" });
      expect(logs.listBySession("git-session")).toContainEqual(expect.objectContaining({ serverId: "git-mcp", method: "tools/call", status: "SENT" }));
      expect(sendChat).toHaveBeenCalledTimes(4);
    } finally {
      await mcp.close();
      await rm(repository, { recursive: true, force: true });
    }
  }, 30_000);
});
