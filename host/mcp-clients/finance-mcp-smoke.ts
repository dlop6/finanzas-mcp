import "dotenv/config";

import { registerFinanceMcpTools } from "@/host/orchestration/finance-mcp-tools";
import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";
import {
  FinanceMcpClientConfigurationError,
  loadFinanceMcpClientConfig,
  startFinanceMcpSession,
} from "./finance-mcp-client";

async function main(): Promise<void> {
  const config = loadFinanceMcpClientConfig();
  const client = await startFinanceMcpSession({ config, onStderr: () => undefined });
  try {
    const registry = new HostMcpToolRegistry();
    await registerFinanceMcpTools(registry, client);
    if (registry.list().length !== 30) throw new Error("invalid catalog");
    const result = await client.toolsCall("get_current_balance");
    if (result.isError) throw new Error("read tool failed");
    process.stdout.write(`Finance MCP ${config.mode} smoke succeeded: 30 tools.\n`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  const code = error instanceof FinanceMcpClientConfigurationError ? error.code : "FAILED";
  process.stderr.write(`Finance MCP client smoke failed: ${code}.\n`);
  process.exitCode = 1;
});
