import { FinanceMcpLifecycle } from "./lifecycle";
import { runFinanceMcpStdioServer } from "./stdio-server";

const lifecycle = new FinanceMcpLifecycle();

void runFinanceMcpStdioServer({ handleMessage: lifecycle.handleMessage }).catch(() => {
  process.stderr.write("Finance MCP STDIO server stopped unexpectedly\n");
  process.exitCode = 1;
});
