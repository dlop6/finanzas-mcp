import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { StdioJsonRpcClient, type StdioJsonRpcClientOptions } from "./stdio-jsonrpc-client";
import { McpLifecycleClient } from "./mcp-lifecycle-client";
import type { McpInteractionLogWriter } from "./mcp-interaction-log";
import type { McpInteractionLogClock } from "./mcp-interaction-log";

const WINDOWS_ENVIRONMENT_KEYS = ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP"] as const;
const POSIX_ENVIRONMENT_KEYS = ["PATH", "TMPDIR", "LANG", "LC_ALL"] as const;
const FINANCE_MCP_ENVIRONMENT_KEYS = ["DATABASE_URL", "NODE_ENV"] as const;

export interface StartFinanceMcpLocalOptions {
  onStderr?: StdioJsonRpcClientOptions["onStderr"];
  interactionLogger?: McpInteractionLogWriter;
  logClock?: McpInteractionLogClock;
}

function allowlistedEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const platformKeys = process.platform === "win32" ? WINDOWS_ENVIRONMENT_KEYS : POSIX_ENVIRONMENT_KEYS;
  const entries = [...FINANCE_MCP_ENVIRONMENT_KEYS, ...platformKeys].flatMap((key) => {
    const value = source[key];

    return value === undefined ? [] : [[key, value] as const];
  });

  return Object.fromEntries(entries) as NodeJS.ProcessEnv;
}

function localFinanceMcpConfiguration(options: StartFinanceMcpLocalOptions): StdioJsonRpcClientOptions {
  const directory = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(directory, "../..");

  return {
    command: process.execPath,
    args: ["--import", "tsx", resolve(projectRoot, "servers/finance-mcp/stdio.ts")],
    cwd: projectRoot,
    env: allowlistedEnvironment(process.env),
    onStderr: options.onStderr,
    serverId: "finance-mcp",
    interactionLogger: options.interactionLogger,
    logClock: options.logClock,
  };
}

export async function startFinanceMcpLocal(
  options: StartFinanceMcpLocalOptions = {},
): Promise<StdioJsonRpcClient> {
  const client = new StdioJsonRpcClient(localFinanceMcpConfiguration(options));
  await client.start();
  return client;
}

export async function startFinanceMcpSessionLocal(
  options: StartFinanceMcpLocalOptions = {},
): Promise<McpLifecycleClient> {
  const transport = await startFinanceMcpLocal(options);
  const client = new McpLifecycleClient(transport);

  await client.initialize();
  return client;
}
