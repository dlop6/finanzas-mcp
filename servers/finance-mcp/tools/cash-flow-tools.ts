import type { FinanceToolDefinition } from "./registry";
import type { CashFlowService, CurrentBalanceService } from "@/servers/finance-mcp/services";
import { isExpectedFinanceError } from "@/servers/finance-mcp/services";
import type { McpCallToolResult } from "@/shared/mcp";
const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
async function run<T>(operation: () => Promise<T>, message: string): Promise<McpCallToolResult> { try { return { content: [{ type: "text", text: message }], structuredContent: await operation() as Record<string, unknown> }; } catch (error) { if (!isExpectedFinanceError(error)) throw error; return { content: [{ type: "text", text: error.message }], isError: true }; } }
export function createCashFlowTools(balance: CurrentBalanceService, cashFlow: CashFlowService): FinanceToolDefinition[] { return [
  { name: "get_current_balance", description: "Get the current balance and account breakdown.", isWriteOperation: false, inputSchema: { type: "object", additionalProperties: false, properties: {} }, handler: () => run(() => balance.getCurrentBalanceSummary(), "Current balance retrieved.") },
  { name: "get_cash_flow_summary", description: "Get a cash-flow summary for an inclusive date range.", isWriteOperation: false, inputSchema: { type: "object", additionalProperties: false, required: ["startDate", "endDate"], properties: { startDate: date, endDate: date } }, handler: (a) => run(() => cashFlow.getCashFlowSummary(a.startDate as string, a.endDate as string), "Cash-flow summary retrieved.") },
]; }
