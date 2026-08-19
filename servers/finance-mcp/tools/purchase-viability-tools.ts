import { isExpectedFinanceError, MONEY_PATTERN, type PurchaseViabilityService } from "@/servers/finance-mcp/services";
import type { FinanceToolDefinition } from "./registry";

export function createPurchaseViabilityTools(service: PurchaseViabilityService): FinanceToolDefinition[] {
  return [{
    name: "evaluate_purchase_viability",
    description: "Evaluate whether a purchase preserves the minimum safety balance.",
    isWriteOperation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["purchaseAmount", "horizonDays"],
      properties: {
        purchaseAmount: { type: "string", pattern: MONEY_PATTERN },
        horizonDays: { type: "integer", enum: [7, 30] },
      },
    },
    handler: async (args) => {
      try {
        const result = await service.evaluatePurchaseViability(args.purchaseAmount as string, args.horizonDays as number);
        return { content: [{ type: "text", text: "Purchase viability evaluated." }], structuredContent: result };
      } catch (error) {
        if (!isExpectedFinanceError(error)) throw error;
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
    },
  }];
}
