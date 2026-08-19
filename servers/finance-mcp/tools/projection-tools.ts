import type { FinanceToolDefinition } from "./registry";
import type { ProjectionService } from "@/servers/finance-mcp/services";
import { isExpectedFinanceError } from "@/servers/finance-mcp/services";

export function createProjectionTools(service: ProjectionService): FinanceToolDefinition[] { return [{
  name: "project_cash_flow", description: "Project cash flow for 7 or 30 days.", isWriteOperation: false,
  inputSchema: { type: "object", additionalProperties: false, required: ["horizonDays"], properties: { horizonDays: { type: "integer", enum: [7, 30] } } },
  handler: async (args) => { try { const result = await service.projectCashFlow(args.horizonDays as 7 | 30); return { content: [{ type: "text", text: "Cash-flow projection retrieved." }], structuredContent: result }; } catch (error) { if (!isExpectedFinanceError(error)) throw error; return { content: [{ type: "text", text: error.message }], isError: true }; } },
}]; }
