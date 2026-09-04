import { resolve, relative, sep } from "node:path";
import type { SessionChatResult, SessionChatService } from "@/host/context";
import type { McpInteractionLogReader } from "@/host/mcp-clients/mcp-interaction-log";
import type { McpLifecycleClient } from "@/host/mcp-clients/mcp-lifecycle-client";
import type { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";
import type { DeepSeekChatMessage } from "@/host/llm";

const REQUIRED_FINANCE_TOOLS = ["get_current_balance", "list_debts", "list_receivables", "list_low_stock_products"] as const;
const REQUIRED_SECTIONS = ["# Financial Report", "## Current Balance", "## Accounts", "## Pending Debts", "## Pending Receivables", "## Low Stock Products"] as const;

export type FinancialReportDemoResult =
  | { status: "completed"; sessionId: string; reportPath: string; commitMessage: string }
  | { status: "cancelled"; sessionId: string; cancelledStep: "write_file" | "git_add" | "git_commit" };

export type FinancialReportDemoClock = { now(): Date };
export type FinancialReportDemoConsole = { write(value: string): void; read(): Promise<string> };

export class FinancialReportDemoError extends Error {
  constructor(
    public readonly code: "PREFLIGHT_FAILED" | "INVALID_CATALOG" | "INVALID_MODEL_RESPONSE" | "INVALID_REPORT" | "PENDING_OPERATION_MISMATCH" | "FILE_VERIFICATION_FAILED" | "GIT_VERIFICATION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "FinancialReportDemoError";
  }
}

export type CreateFinancialReportDemoOptions = {
  sessionChat: SessionChatService;
  registry: HostMcpToolRegistry;
  filesystemClient: McpLifecycleClient;
  gitClient: McpLifecycleClient;
  interactionLogs: McpInteractionLogReader;
  projectRoot: string;
  clock?: FinancialReportDemoClock;
  console: FinancialReportDemoConsole;
};

function timestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function textContent(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n");
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== "" && !path.startsWith(`..${sep}`) && path !== ".." && !path.includes(`..${sep}`);
}

function completedContent(result: SessionChatResult): string {
  if (result.status !== "completed" || typeof result.response.content !== "string") {
    throw new FinancialReportDemoError("INVALID_MODEL_RESPONSE", "The model did not complete the report step.");
  }
  return result.response.content;
}

function toolCalls(messages: readonly DeepSeekChatMessage[]): string[] {
  return messages.flatMap((message) => message.role === "assistant" ? (message.toolCalls ?? []).map((call) => call.function.name) : []);
}

function requirePending(result: SessionChatResult, serverId: string, toolName: string, expectedArguments: Record<string, unknown>): void {
  if (result.status !== "confirmation_required" || result.pendingOperation.serverId !== serverId || result.pendingOperation.toolName !== toolName || JSON.stringify(result.pendingOperation.arguments) !== JSON.stringify(expectedArguments)) {
    throw new FinancialReportDemoError("PENDING_OPERATION_MISMATCH", "The requested write operation does not match the demo step.");
  }
}

export function createFinancialReportDemo(options: CreateFinancialReportDemoOptions): { run(): Promise<FinancialReportDemoResult> } {
  const clock = options.clock ?? { now: () => new Date() };
  const gitDemoPath = resolve(options.projectRoot, "docs/generated/git-demo");

  async function awaitConfirmation(sessionId: string, pending: SessionChatResult, step: "write_file" | "git_add" | "git_commit"): Promise<"confirmed" | "cancelled"> {
    let current = pending;
    while (current.status === "confirmation_required") {
      options.console.write(`${current.message}\n`);
      const response = await options.sessionChat.sendMessage(sessionId, await options.console.read());
      if (response.status === "cancelled") return "cancelled";
      current = response;
    }
    if (current.status !== "completed") throw new FinancialReportDemoError("INVALID_MODEL_RESPONSE", `The ${step} step did not complete.`);
    return "confirmed";
  }

  return {
    async run() {
      const mark = timestamp(clock.now());
      const reportFilename = `financial-report-${mark}.md`;
      const reportPath = resolve(gitDemoPath, reportFilename);
      const commitMessage = `docs: add financial report ${mark}`;
      if (!isWithin(gitDemoPath, reportPath)) throw new FinancialReportDemoError("PREFLIGHT_FAILED", "The report path is outside the demo repository.");
      const allTools = options.registry.list();
      if (allTools.length !== 51 || allTools.filter((tool) => tool.isWriteOperation).length !== 24) throw new FinancialReportDemoError("INVALID_CATALOG", "The local MCP catalog is incomplete.");

      const allowed = await options.filesystemClient.toolsCall("list_allowed_directories");
      if (!textContent(allowed).includes(resolve(options.projectRoot, "docs/generated"))) throw new FinancialReportDemoError("PREFLIGHT_FAILED", "The Filesystem MCP sandbox is unavailable.");
      const initialStatus = await options.gitClient.toolsCall("git_status", { repo_path: gitDemoPath });
      if (!/clean|nothing to commit/i.test(textContent(initialStatus))) throw new FinancialReportDemoError("PREFLIGHT_FAILED", "The demo Git repository must be clean.");

      const session = options.sessionChat.createSession({ systemPrompt: "You are the report writer. Use only Finance MCP data. In your first answer call exactly get_current_balance, list_debts with status PENDING, list_receivables with status PENDING, and list_low_stock_products. Do not write files or calculate financial values. After tool results, produce an English Markdown report with these headings: # Financial Report, ## Current Balance, ## Accounts, ## Pending Debts, ## Pending Receivables, ## Low Stock Products." });
      const reportTurn = await options.sessionChat.sendMessage(session.sessionId, "Generate a complete current financial report in Markdown.");
      const markdown = completedContent(reportTurn);
      const called = toolCalls(reportTurn.status === "completed" ? reportTurn.turnMessages : []);
      if (called.length !== 4 || REQUIRED_FINANCE_TOOLS.some((tool) => !called.includes(tool)) || REQUIRED_SECTIONS.some((section) => !markdown.includes(section))) {
        throw new FinancialReportDemoError("INVALID_REPORT", "The model did not generate the required report.");
      }
      options.console.write(`${markdown}\n`);

      const writeArgs = { path: reportPath, content: markdown };
      const writeTurn = await options.sessionChat.sendMessage(session.sessionId, `Request exactly write_file with path ${JSON.stringify(reportPath)} and content equal to the Markdown report from the previous turn.`);
      requirePending(writeTurn, "filesystem-mcp", "write_file", writeArgs);
      if (await awaitConfirmation(session.sessionId, writeTurn, "write_file") === "cancelled") return { status: "cancelled", sessionId: session.sessionId, cancelledStep: "write_file" };
      const file = await options.filesystemClient.toolsCall("read_text_file", { path: reportPath }, { sessionId: session.sessionId });
      if (textContent(file) !== markdown) throw new FinancialReportDemoError("FILE_VERIFICATION_FAILED", "The saved report could not be verified.");

      const addArgs = { repo_path: gitDemoPath, files: [reportFilename] };
      const beforeAdd = await options.gitClient.toolsCall("git_diff_staged", { repo_path: gitDemoPath }, { sessionId: session.sessionId });
      if (textContent(beforeAdd).includes(reportFilename)) throw new FinancialReportDemoError("GIT_VERIFICATION_FAILED", "The report is already staged.");
      const addTurn = await options.sessionChat.sendMessage(session.sessionId, `Request exactly git_add with repo_path ${JSON.stringify(gitDemoPath)} and files ${JSON.stringify([reportFilename])}.`);
      requirePending(addTurn, "git-mcp", "git_add", addArgs);
      if (await awaitConfirmation(session.sessionId, addTurn, "git_add") === "cancelled") return { status: "cancelled", sessionId: session.sessionId, cancelledStep: "git_add" };
      const staged = await options.gitClient.toolsCall("git_diff_staged", { repo_path: gitDemoPath }, { sessionId: session.sessionId });
      if (!textContent(staged).includes(reportFilename)) throw new FinancialReportDemoError("GIT_VERIFICATION_FAILED", "The report was not staged.");

      const commitArgs = { repo_path: gitDemoPath, message: commitMessage };
      const beforeCommit = await options.gitClient.toolsCall("git_log", { repo_path: gitDemoPath }, { sessionId: session.sessionId });
      if (textContent(beforeCommit).includes(commitMessage)) throw new FinancialReportDemoError("GIT_VERIFICATION_FAILED", "The report commit already exists.");
      const commitTurn = await options.sessionChat.sendMessage(session.sessionId, `Request exactly git_commit with repo_path ${JSON.stringify(gitDemoPath)} and message ${JSON.stringify(commitMessage)}.`);
      requirePending(commitTurn, "git-mcp", "git_commit", commitArgs);
      if (await awaitConfirmation(session.sessionId, commitTurn, "git_commit") === "cancelled") return { status: "cancelled", sessionId: session.sessionId, cancelledStep: "git_commit" };
      const log = await options.gitClient.toolsCall("git_log", { repo_path: gitDemoPath }, { sessionId: session.sessionId });
      const finalStatus = await options.gitClient.toolsCall("git_status", { repo_path: gitDemoPath }, { sessionId: session.sessionId });
      if (!textContent(log).includes(commitMessage) || !/clean|nothing to commit/i.test(textContent(finalStatus))) throw new FinancialReportDemoError("GIT_VERIFICATION_FAILED", "The report commit could not be verified.");

      return { status: "completed", sessionId: session.sessionId, reportPath, commitMessage };
    },
  };
}
