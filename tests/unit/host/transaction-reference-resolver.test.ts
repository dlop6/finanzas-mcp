import { describe, expect, it, vi } from "vitest";
import { TransactionReferenceResolver } from "@/host/confirmation";
import { HostMcpToolRegistry } from "@/host/orchestration/mcp-tool-registry";

async function registryWith(result: object) {
  const toolsCall = vi.fn().mockResolvedValue(result);
  const registry = new HostMcpToolRegistry();
  await registry.registerServer({
    serverId: "finance-mcp",
    client: {
      toolsList: vi.fn().mockResolvedValue({ tools: [{ name: "get_transaction_reference_data", description: "References", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] }),
      toolsCall,
    },
    metadata: { get_transaction_reference_data: { isWriteOperation: false } },
  });
  return { registry, toolsCall };
}

describe("TransactionReferenceResolver", () => {
  it("uses the Finance MCP owner and returns verified display names", async () => {
    const { registry, toolsCall } = await registryWith({
      content: [],
      structuredContent: {
        accounts: [{ id: 1, name: "Banco", type: "BANK" }],
        categories: [{ id: 2, name: "Ventas", type: "INCOME" }],
      },
    });

    await expect(new TransactionReferenceResolver(registry).resolve("chat-a", "INCOME", 1, 2)).resolves.toEqual({ accountName: "Banco", categoryName: "Ventas" });
    expect(toolsCall).toHaveBeenCalledWith("get_transaction_reference_data", { type: "INCOME" }, { sessionId: "chat-a" });
  });

  it("resolves mixed rows against their matching reference catalogs", async () => {
    const { registry, toolsCall } = await registryWith({
      content: [],
      structuredContent: {
        accounts: [{ id: 1, name: "Efectivo", type: "CASH" }],
        categories: [{ id: 2, name: "Ventas", type: "INCOME" }],
      },
    });
    toolsCall.mockResolvedValueOnce({ content: [], structuredContent: { accounts: [{ id: 1, name: "Efectivo", type: "CASH" }], categories: [{ id: 2, name: "Ventas", type: "INCOME" }] } });
    toolsCall.mockResolvedValueOnce({ content: [], structuredContent: { accounts: [{ id: 1, name: "Efectivo", type: "CASH" }], categories: [{ id: 3, name: "Marketing", type: "EXPENSE" }] } });

    await expect(new TransactionReferenceResolver(registry).resolveMixedBatch("chat-a", [
      { type: "INCOME", accountId: 1, categoryId: 2 },
      { type: "EXPENSE", accountId: 1, categoryId: 3 },
    ])).resolves.toEqual([
      { accountName: "Efectivo", categoryName: "Ventas" },
      { accountName: "Efectivo", categoryName: "Marketing" },
    ]);
    expect(toolsCall).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a proposed category is absent or has the wrong transaction type", async () => {
    const { registry } = await registryWith({
      content: [],
      structuredContent: { accounts: [{ id: 1, name: "Banco", type: "BANK" }], categories: [{ id: 2, name: "Inventario", type: "EXPENSE" }] },
    });

    await expect(new TransactionReferenceResolver(registry).resolve("chat-a", "INCOME", 1, 2)).rejects.toMatchObject({ code: "TRANSACTION_REFERENCE_LOOKUP_FAILED" });
  });
});
