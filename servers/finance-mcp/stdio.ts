import { FinanceMcpLifecycle } from "./lifecycle";
import { runFinanceMcpStdioServer } from "./stdio-server";
import { FinanceToolRegistry } from "./tools/registry";

const lifecycle = new FinanceMcpLifecycle(new FinanceToolRegistry());

void runFinanceMcpStdioServer({ handleMessage: lifecycle.handleMessage }).catch(() => {
  process.stderr.write("Finance MCP STDIO server stopped unexpectedly\n");
  process.exitCode = 1;
});
