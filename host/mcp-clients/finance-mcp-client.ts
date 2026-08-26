import type { StdioJsonRpcClientOptions } from "./stdio-jsonrpc-client";
import { startFinanceMcpSessionLocal } from "./finance-mcp-local";
import type { McpInteractionLogClock, McpInteractionLogWriter } from "./mcp-interaction-log";
import { McpLifecycleClient } from "./mcp-lifecycle-client";
import { StreamableHttpJsonRpcClient, type StreamableHttpFetch } from "./streamable-http-jsonrpc-client";

export const FINANCE_MCP_REMOTE_TIMEOUT_MS = 60_000;

export type FinanceMcpClientConfig =
  | { mode: "local" }
  | { mode: "remote"; endpoint: URL; timeoutMs: typeof FINANCE_MCP_REMOTE_TIMEOUT_MS };

export type FinanceMcpClientEnvironment = Record<string, string | undefined>;

export class FinanceMcpClientConfigurationError extends Error {
  constructor(public readonly code: "CONFIGURATION_ERROR", message: string) {
    super(message);
    this.name = "FinanceMcpClientConfigurationError";
  }
}

export type StartFinanceMcpSessionOptions = {
  environment?: FinanceMcpClientEnvironment;
  config?: FinanceMcpClientConfig;
  interactionLogger?: McpInteractionLogWriter;
  onStderr?: StdioJsonRpcClientOptions["onStderr"];
  fetchImpl?: StreamableHttpFetch;
  logClock?: McpInteractionLogClock;
  timeoutMs?: number;
};

function configurationError(): FinanceMcpClientConfigurationError {
  return new FinanceMcpClientConfigurationError("CONFIGURATION_ERROR", "Finance MCP client configuration is invalid.");
}

export function loadFinanceMcpClientConfig(environment: FinanceMcpClientEnvironment = process.env): FinanceMcpClientConfig {
  const mode = environment.FINANCE_MCP_MODE?.trim().toLowerCase() || "local";
  if (mode === "local") return { mode };
  if (mode !== "remote") throw configurationError();

  const value = environment.FINANCE_MCP_REMOTE_URL?.trim();
  if (!value) throw configurationError();
  try {
    const endpoint = new URL(value);
    if (
      endpoint.protocol !== "https:"
      || endpoint.pathname !== "/mcp"
      || endpoint.search
      || endpoint.hash
      || endpoint.username
      || endpoint.password
    ) {
      throw new Error();
    }
    return { mode, endpoint, timeoutMs: FINANCE_MCP_REMOTE_TIMEOUT_MS };
  } catch {
    throw configurationError();
  }
}

export async function startFinanceMcpSession(options: StartFinanceMcpSessionOptions = {}): Promise<McpLifecycleClient> {
  const config = options.config ?? loadFinanceMcpClientConfig(options.environment);
  if (config.mode === "local") {
    return startFinanceMcpSessionLocal({
      interactionLogger: options.interactionLogger,
      onStderr: options.onStderr,
      logClock: options.logClock,
    });
  }

  const transport = new StreamableHttpJsonRpcClient({
    endpoint: config.endpoint,
    timeoutMs: options.timeoutMs ?? config.timeoutMs,
    fetchImpl: options.fetchImpl,
    interactionLogger: options.interactionLogger,
    logClock: options.logClock,
    serverId: "finance-mcp",
  });
  await transport.start();
  const client = new McpLifecycleClient(transport);
  try {
    await client.initialize();
    return client;
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
}
