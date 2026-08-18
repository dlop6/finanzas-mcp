import { FinanceMcpLifecycle } from "./lifecycle";
import { runFinanceMcpStdioServer } from "./stdio-server";
import { prisma } from "@/database/client";
import { createFinanceToolRegistry } from "./composition";

const lifecycle = new FinanceMcpLifecycle(createFinanceToolRegistry(prisma));

void runFinanceMcpStdioServer({ handleMessage: lifecycle.handleMessage }).catch(() => {
  process.stderr.write("Finance MCP STDIO server stopped unexpectedly\n");
  process.exitCode = 1;
});
