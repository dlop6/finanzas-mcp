import { describe, expect, it, vi } from "vitest";
import {
  REMOTE_MUTATION_DESCRIPTION_PREFIX,
  RemoteFinanceValidationError,
  assertRemoteMode,
  compareFinanceToolContracts,
  reconcileProjection,
  runRemoteFinanceValidation,
  sanitizeRemoteFailure,
  type RemoteFinanceValidationClient,
} from "@/scripts/finance/remote-validation";
import { createFinanceToolRegistry } from "@/servers/finance-mcp/composition";
import type { PrismaClient } from "@/database/generated/prisma/client";
import { InMemoryMcpInteractionLogStore } from "@/host/mcp-clients/mcp-interaction-log";

function fakeClient(): RemoteFinanceValidationClient {
  return {
    state: "READY",
    toolsList: vi.fn(),
    toolsCall: vi.fn(),
    close: vi.fn(async () => undefined),
  } as unknown as RemoteFinanceValidationClient;
}

describe("remote Finance MCP validation helpers", () => {
  it("requires remote mode without exposing configuration", () => {
    expect(() => assertRemoteMode({ mode: "local" })).toThrowError(RemoteFinanceValidationError);
    expect(() => assertRemoteMode({ mode: "local" })).toThrow(/REMOTE_MODE_REQUIRED/);
  });

  it("compares the complete public Finance MCP contract", () => {
    const expected = [
      { name: "get_current_balance", description: "Balance", inputSchema: { type: "object" } },
    ];
    expect(() => compareFinanceToolContracts(expected, expected)).not.toThrow();
    expect(() => compareFinanceToolContracts(expected, [{ ...expected[0], description: "Changed" }])).toThrow(/CONTRACT_MISMATCH/);
  });

  it("reconciles projections using decimal strings", () => {
    expect(reconcileProjection({
      currentBalance: "19475.00",
      confirmedReceivables: "3200.00",
      unconfirmedReceivables: "1800.00",
      fixedExpenses: "3150.00",
      pendingDebts: "3050.00",
      safeProjectedBalance: "16475.00",
      potentialProjectedBalance: "18275.00",
    })).toBe(true);
  });

  it("rejects inconsistent projection totals", () => {
    expect(() => reconcileProjection({
      currentBalance: "19475.00",
      confirmedReceivables: "3200.00",
      unconfirmedReceivables: "1800.00",
      fixedExpenses: "3150.00",
      pendingDebts: "3050.00",
      safeProjectedBalance: "0.00",
      potentialProjectedBalance: "18275.00",
    })).toThrow(/REMOTE_READ_FAILED/);
  });

  it("sanitizes remote failures without retaining endpoint or response data", () => {
    const error = sanitizeRemoteFailure(new Error("https://secret.example/mcp body Authorization Bearer hidden"));
    expect(error).toEqual({ code: "TRANSPORT_FAILURE", status: undefined });
    expect(JSON.stringify(error)).not.toContain("secret.example");
    expect(REMOTE_MUTATION_DESCRIPTION_PREFIX).toBe("UN-43 remote validation");
  });

  it("keeps the client contract small and lifecycle-owned", () => {
    const client = fakeClient();
    expect(typeof client.toolsList).toBe("function");
    expect(typeof client.toolsCall).toBe("function");
    expect(typeof client.close).toBe("function");
  });

  it("runs the complete reversible validation with injected remote dependencies", async () => {
    const tools = createFinanceToolRegistry({} as PrismaClient).list();
    let created = true;
    let description = `${REMOTE_MUTATION_DESCRIPTION_PREFIX} stale`;
    const client = {
      state: "READY",
      toolsList: vi.fn(async () => ({ tools })),
      toolsCall: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
        if (name === "get_current_balance") return { content: [{ type: "text", text: "ok" }], structuredContent: { currency: "GTQ", currentBalance: created ? "19476.00" : "19475.00", totalIncome: created ? "13426.00" : "13425.00", totalExpenses: "8950.00", accounts: [{ initialBalance: "5000.00", income: "5000.00", expenses: "3225.00", balance: "6775.00" }, { initialBalance: "10000.00", income: created ? "8426.00" : "8425.00", expenses: "5725.00", balance: created ? "12701.00" : "12700.00" }] } };
        if (name === "list_transactions") return { content: [{ type: "text", text: "ok" }], structuredContent: { transactions: Array.from({ length: created ? 21 : 20 }, (_, index) => ({ id: index + 1, accountId: 1, categoryId: 1, type: "INCOME", description: index === 20 ? description : null })) } };
        if (name === "project_cash_flow" && args.horizonDays === 14) return { content: [{ type: "text", text: "invalid" }], isError: true };
        if (name === "project_cash_flow") return { content: [{ type: "text", text: "ok" }], structuredContent: { currency: "GTQ", asOfDate: "2026-08-08", throughDate: args.horizonDays === 7 ? "2026-08-15" : "2026-09-07", horizonDays: args.horizonDays, currentBalance: "19475.00", confirmedReceivables: "3200.00", unconfirmedReceivables: "1800.00", fixedExpenses: "3150.00", pendingDebts: "3050.00", safeProjectedBalance: "16475.00", potentialProjectedBalance: "18275.00" } };
        if (name === "evaluate_purchase_viability") return { content: [{ type: "text", text: "ok" }], structuredContent: { currency: "GTQ", asOfDate: "2026-08-08", throughDate: "2026-09-07", horizonDays: 30, purchaseAmount: "1.00", safeProjectedBalance: "16475.00", potentialProjectedBalance: "18275.00", minimumSafetyBalance: "1500.00", safeBalanceAfterPurchase: "16474.00", potentialBalanceAfterPurchase: "18274.00", maximumSafePurchase: "14975.00", status: "VIABLE", confirmedReceivables: "3200.00", unconfirmedReceivables: "1800.00", fixedExpenses: "3150.00", pendingDebts: "3050.00" } };
        if (name === "record_income") { created = true; description = String(args.description); return { content: [{ type: "text", text: "Income recorded." }], structuredContent: { transaction: { id: 21 } } }; }
        if (name === "delete_transaction") { created = false; return { content: [{ type: "text", text: "Transaction deleted." }], structuredContent: { transaction: { id: args.transactionId } } }; }
        if (name === "un_43_unknown_finance_tool") throw new Error("remote invalid params");
        return { content: [{ type: "text", text: "unexpected" }], isError: true };
      }),
      close: vi.fn(async () => undefined),
    } as unknown as RemoteFinanceValidationClient;
    const logs = new InMemoryMcpInteractionLogStore();
    logs.append({ timestamp: "2026-08-25T00:00:00.000Z", sessionId: "HOST", serverId: "finance-mcp", transport: "STREAMABLE_HTTP", direction: "HOST_TO_MCP", messageType: "request", method: "initialize", requestId: 1, payload: "{}", status: "SENT" });
    const answers = ["sí", "sí", "sí"];
    const output: string[] = [];

    await runRemoteFinanceValidation({
      config: { mode: "remote", endpoint: new URL("https://example.test/mcp"), timeoutMs: 60_000 },
      client,
      interactionLogs: logs,
      now: () => new Date("2026-08-25T12:00:00.000Z"),
      prompt: async () => answers.shift() ?? "sí",
      output: (line) => output.push(line),
    });

    expect(client.close).toHaveBeenCalledOnce();
    expect(output).toEqual(expect.arrayContaining(["contract: passed", "confirmed creation: passed", "confirmed cleanup: passed"]));
    expect(client.toolsCall).toHaveBeenCalledWith("delete_transaction", { transactionId: 21 });
    expect((client.toolsCall as ReturnType<typeof vi.fn>).mock.calls.filter(([name]) => name === "delete_transaction")).toHaveLength(2);
    expect(created).toBe(false);
  });
});
