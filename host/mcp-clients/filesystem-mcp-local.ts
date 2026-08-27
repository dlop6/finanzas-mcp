import { createRequire } from "node:module";
import { resolve } from "node:path";
import { StdioJsonRpcClient, type StdioJsonRpcClientOptions } from "./stdio-jsonrpc-client";
import { McpLifecycleClient } from "./mcp-lifecycle-client";
import type { McpInteractionLogWriter } from "./mcp-interaction-log";

const WINDOWS_ENVIRONMENT_KEYS = ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP"] as const;
const POSIX_ENVIRONMENT_KEYS = ["PATH", "TMPDIR", "LANG", "LC_ALL"] as const;
export const FILESYSTEM_MCP_SERVER_ID = "filesystem-mcp";

export interface StartFilesystemMcpLocalOptions {
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

export function filesystemMcpAllowedDirectory(projectRoot: string = process.cwd()): string {
  return resolve(projectRoot, "docs/generated");
}

function filesystemMcpConfiguration(options: StartFilesystemMcpLocalOptions): StdioJsonRpcClientOptions {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const projectRequire = createRequire(resolve(projectRoot, "package.json"));

  return {
    command: process.execPath,
    args: [projectRequire.resolve("@modelcontextprotocol/server-filesystem/dist/index.js"), filesystemMcpAllowedDirectory(projectRoot)],
    cwd: projectRoot,
    env: allowlistedEnvironment(process.env),
    onStderr: options.onStderr,
    serverId: FILESYSTEM_MCP_SERVER_ID,
    interactionLogger: options.interactionLogger,
  };
}

export async function startFilesystemMcpLocal(
  options: StartFilesystemMcpLocalOptions = {},
): Promise<StdioJsonRpcClient> {
  const client = new StdioJsonRpcClient(filesystemMcpConfiguration(options));
  await client.start();
  return client;
}

export async function startFilesystemMcpSessionLocal(
  options: StartFilesystemMcpLocalOptions = {},
): Promise<McpLifecycleClient> {
  const transport = await startFilesystemMcpLocal(options);
  const client = new McpLifecycleClient(transport);
  await client.initialize();
  return client;
}
