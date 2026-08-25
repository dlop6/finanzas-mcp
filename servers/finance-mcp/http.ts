import { once } from "node:events";
import { prisma } from "@/database/client";
import { createFinanceToolRegistry } from "./composition";
import { createFinanceMcpHttpServer, loadFinanceMcpHttpConfig } from "./http-server";
import { FinanceMcpLifecycle } from "./lifecycle";

const config = loadFinanceMcpHttpConfig();
const tools = createFinanceToolRegistry(prisma);
const server = createFinanceMcpHttpServer({
  config,
  createHandler: () => new FinanceMcpLifecycle(tools).handleMessage,
  diagnostics: (message) => process.stderr.write(`${message}\n`),
});

async function close(): Promise<void> {
  server.close();
  await once(server, "close").catch(() => undefined);
  await prisma.$disconnect();
}

server.listen(config.port, config.host, () => {
  process.stderr.write(`Finance MCP HTTP server listening on ${config.host}:${config.port}\n`);
});
process.once("SIGINT", () => { void close().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void close().finally(() => process.exit(0)); });
