import type { McpToolClient } from "./mcp-tool-registry";
import { HostMcpToolRegistry, type HostToolMetadata } from "./mcp-tool-registry";

export const FINANCE_MCP_SERVER_ID = "finance-mcp";

export const financeMcpToolMetadata = {
  record_income: { isWriteOperation: true },
  record_expense: { isWriteOperation: true },
  record_transactions_batch: { isWriteOperation: true },
  get_transaction_reference_data: { isWriteOperation: false },
  list_transactions: { isWriteOperation: false },
  update_transaction: { isWriteOperation: true },
  delete_transaction: { isWriteOperation: true },
  record_debt: { isWriteOperation: true },
  list_debts: { isWriteOperation: false },
  update_debt: { isWriteOperation: true },
  mark_debt_paid: { isWriteOperation: true },
  delete_debt: { isWriteOperation: true },
  record_receivable: { isWriteOperation: true },
  list_receivables: { isWriteOperation: false },
  update_receivable: { isWriteOperation: true },
  mark_receivable_collected: { isWriteOperation: true },
  delete_receivable: { isWriteOperation: true },
  create_product: { isWriteOperation: true },
  list_products: { isWriteOperation: false },
  update_product: { isWriteOperation: true },
  record_inventory_movement: { isWriteOperation: true },
  list_low_stock_products: { isWriteOperation: false },
  get_current_balance: { isWriteOperation: false },
  get_cash_flow_summary: { isWriteOperation: false },
  project_cash_flow: { isWriteOperation: false },
  evaluate_purchase_viability: { isWriteOperation: false },
} as const satisfies Readonly<Record<string, HostToolMetadata>>;

export async function registerFinanceMcpTools(
  registry: HostMcpToolRegistry,
  client: McpToolClient,
): Promise<void> {
  await registry.registerServer({
    serverId: FINANCE_MCP_SERVER_ID,
    client,
    metadata: financeMcpToolMetadata,
  });
}
