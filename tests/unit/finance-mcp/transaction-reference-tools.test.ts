import { describe, expect, it, vi } from "vitest";
import { createTransactionReferenceTools } from "@/servers/finance-mcp/tools/transaction-reference-tools";

describe("transaction reference tool", () => {
  it("returns only accounts and categories compatible with the requested transaction type", async () => {
    const getReferenceData = vi.fn().mockResolvedValue({
      currency: "GTQ",
      accounts: [{ id: 1, name: "Efectivo", type: "CASH" }],
      categories: [{ id: 3, name: "Otros ingresos", type: "INCOME" }],
    });
    const tool = createTransactionReferenceTools({ getReferenceData } as never)[0];

    await expect(tool.handler({ type: "INCOME" })).resolves.toEqual({
      content: [{ type: "text", text: "Transaction reference data retrieved." }],
      structuredContent: {
        currency: "GTQ",
        accounts: [{ id: 1, name: "Efectivo", type: "CASH" }],
        categories: [{ id: 3, name: "Otros ingresos", type: "INCOME" }],
      },
    });
    expect(getReferenceData).toHaveBeenCalledWith("INCOME");
  });
});
