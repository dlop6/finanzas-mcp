import { createMethodNotFoundHandler, runFinanceMcpStdioServer } from "./stdio-server";

void runFinanceMcpStdioServer({ handleMessage: createMethodNotFoundHandler() }).catch(() => {
  process.stderr.write("Finance MCP STDIO server stopped unexpectedly\n");
  process.exitCode = 1;
});
