import { FinanceMcpLifecycle } from "@/servers/finance-mcp/lifecycle";
import { runFinanceMcpStdioServer } from "@/servers/finance-mcp/stdio-server";
import { FinanceToolRegistry, type FinanceToolDefinition } from "@/servers/finance-mcp/tools/registry";

const tool: FinanceToolDefinition = {
  name: "test.echo",
  description: "Returns the provided test message.",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
    additionalProperties: false,
  },
  isWriteOperation: false,
  handler: ({ message }) => ({ content: [{ type: "text", text: String(message) }] }),
};

const lifecycle = new FinanceMcpLifecycle(new FinanceToolRegistry([tool]));
void runFinanceMcpStdioServer({ handleMessage: lifecycle.handleMessage });
