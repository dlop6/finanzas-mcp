import { resolve } from "node:path";
import { StdioJsonRpcClient, type StdioJsonRpcClientOptions } from "./stdio-jsonrpc-client";
import { McpLifecycleClient } from "./mcp-lifecycle-client";
import type { McpInteractionLogWriter } from "./mcp-interaction-log";

const WINDOWS_ENVIRONMENT_KEYS = ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP"] as const;
const POSIX_ENVIRONMENT_KEYS = ["PATH", "TMPDIR", "LANG", "LC_ALL"] as const;

export const GIT_MCP_SERVER_ID = "git-mcp";

export interface StartGitMcpLocalOptions {
  onStderr?: StdioJsonRpcClientOptions["onStderr"];
  interactionLogger?: McpInteractionLogWriter;
  projectRoot?: string;
}

function allowlistedEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keys = process.platform === "win32" ? WINDOWS_ENVIRONMENT_KEYS : POSIX_ENVIRONMENT_KEYS;
  return Object.fromEntries(
    keys.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]] as const]),
  ) as NodeJS.ProcessEnv;
}

function defaultProjectRoot(): string {
  return resolve(process.cwd());
}

export function gitMcpDemoRepositoryPath(projectRoot: string = defaultProjectRoot()): string {
  return resolve(projectRoot, "docs/generated/git-demo");
}

export function gitMcpPythonPath(projectRoot: string = defaultProjectRoot()): string {
  return resolve(projectRoot, ".venv-git-mcp", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
}

export function gitMcpConfiguration(options: StartGitMcpLocalOptions = {}): StdioJsonRpcClientOptions {
  const projectRoot = options.projectRoot ?? defaultProjectRoot();
  return {
    command: gitMcpPythonPath(projectRoot),
    args: ["-m", "mcp_server_git", "--repository", gitMcpDemoRepositoryPath(projectRoot)],
    cwd: projectRoot,
    env: allowlistedEnvironment(process.env),
    onStderr: options.onStderr,
    serverId: GIT_MCP_SERVER_ID,
    interactionLogger: options.interactionLogger,
  };
}

export async function startGitMcpLocal(options: StartGitMcpLocalOptions = {}): Promise<StdioJsonRpcClient> {
  const client = new StdioJsonRpcClient(gitMcpConfiguration(options));
  await client.start();
  return client;
}

export async function startGitMcpSessionLocal(options: StartGitMcpLocalOptions = {}): Promise<McpLifecycleClient> {
  const transport = await startGitMcpLocal(options);
  const client = new McpLifecycleClient(transport);
  await client.initialize();
  return client;
}
