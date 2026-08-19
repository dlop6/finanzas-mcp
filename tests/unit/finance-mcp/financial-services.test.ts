import { Prisma } from "@/database/generated/prisma/client";
import type { BusinessRepository, DebtRepository, ReceivableRepository, TransactionRepository } from "@/servers/finance-mcp/repositories";
import { CashFlowService, CurrentBalanceService, ProjectionService } from "@/servers/finance-mcp/services";
import { describe, expect, it, vi } from "vitest";

const decimal = (value: string) => new Prisma.Decimal(value);
const account = (id: number, name: string, initialBalance: string) => ({ id, businessId: 1, name, type: "CASH" as const, initialBalance: decimal(initialBalance), createdAt: new Date(), updatedAt: new Date() });
const transaction = (id: number, accountId: number, type: "INCOME" | "EXPENSE", amount: string, date: string) => ({ id, businessId: 1, accountId, categoryId: 1, type, amount: decimal(amount), date: new Date(`${date}T00:00:00.000Z`), description: null, createdAt: new Date(), updatedAt: new Date() });

describe("financial services", () => {
  it("calculates Decimal balance by account and total", async () => {
    const business = { getActiveBusiness: vi.fn().mockResolvedValue({ id: 1, currency: "GTQ", minimumSafetyBalance: decimal("1500.00") }), listAccounts: vi.fn().mockResolvedValue([account(2, "Banco", "12000.00"), account(1, "Efectivo", "3000.00")]) };
    const transactions = { list: vi.fn().mockResolvedValue([transaction(1, 1, "INCOME", "100.10", "2026-08-01"), transaction(2, 2, "EXPENSE", "20.05", "2026-08-02")]) };
    const service = new CurrentBalanceService(business as unknown as BusinessRepository, transactions as unknown as TransactionRepository);

    await expect(service.getCurrentBalanceSummary()).resolves.toMatchObject({ currentBalance: "15080.05", totalIncome: "100.10", totalExpenses: "20.05", accounts: [
      expect.objectContaining({ name: "Banco", balance: "11979.95" }),
      expect.objectContaining({ name: "Efectivo", balance: "3100.10" }),
    ] });
    expect(transactions.list).toHaveBeenCalledWith();
  });

  it("summarizes an inclusive period and rejects inverted ranges", async () => {
    const tx = { list: vi.fn().mockResolvedValue([transaction(1, 1, "INCOME", "10.00", "2026-08-08"), transaction(2, 1, "EXPENSE", "3.25", "2026-08-08")]) };
    const balance = { getCurrentBalance: vi.fn().mockResolvedValue({ currency: "GTQ", amount: "100.00" }) };
    const service = new CashFlowService(tx as unknown as TransactionRepository, balance as unknown as CurrentBalanceService);

    await expect(service.getCashFlowSummary("2026-08-08", "2026-08-08")).resolves.toMatchObject({ income: "10.00", expenses: "3.25", netCashFlow: "6.75", transactionCount: 2 });
    await expect(service.getCashFlowSummary("2026-08-09", "2026-08-08")).rejects.toThrow("Start date");
    expect(tx.list).toHaveBeenCalledWith({ startDate: new Date("2026-08-08T00:00:00.000Z"), endDate: new Date("2026-08-08T00:00:00.000Z") });
  });

  it("projects only future records within the inclusive horizon", async () => {
    const business = {
      getActiveBusiness: vi.fn().mockResolvedValue({ id: 1, currency: "GTQ", minimumSafetyBalance: decimal("1500.00") }),
      listFixedExpenses: vi.fn().mockResolvedValue([{ id: 1, businessId: 1, categoryId: 1, name: "Internet", amount: decimal("50.00"), dueDay: 10, active: true, createdAt: new Date(), updatedAt: new Date() }]),
    };
    const debts = { list: vi.fn().mockResolvedValue([{ id: 1, businessId: 1, description: "Debt", amount: decimal("25.00"), dueDate: new Date("2026-08-15T00:00:00.000Z"), priority: "LOW", status: "PENDING", createdAt: new Date(), updatedAt: new Date() }]) };
    const receivables = { list: vi.fn().mockResolvedValue([
      { id: 1, businessId: 1, description: "Confirmed", amount: decimal("100.00"), expectedDate: new Date("2026-08-09T00:00:00.000Z"), confidence: "CONFIRMED", status: "PENDING", createdAt: new Date(), updatedAt: new Date() },
      { id: 2, businessId: 1, description: "Same day", amount: decimal("99.00"), expectedDate: new Date("2026-08-08T00:00:00.000Z"), confidence: "CONFIRMED", status: "PENDING", createdAt: new Date(), updatedAt: new Date() },
    ]) };
    const balance = { getCurrentBalance: vi.fn().mockResolvedValue({ currency: "GTQ", amount: "1000.00" }) };
    const service = new ProjectionService(
      business as unknown as BusinessRepository,
      debts as unknown as DebtRepository,
      receivables as unknown as ReceivableRepository,
      balance as unknown as CurrentBalanceService,
      { todayUtc: () => new Date("2026-08-08T00:00:00.000Z") },
    );

    await expect(service.projectCashFlow(7)).resolves.toMatchObject({ confirmedReceivables: "100.00", fixedExpenses: "50.00", pendingDebts: "25.00", safeProjectedBalance: "1025.00", potentialProjectedBalance: "1025.00", details: { confirmedReceivables: [expect.objectContaining({ id: 1 })] } });
    expect(debts.list).toHaveBeenCalledWith({ status: "PENDING", dueBefore: new Date("2026-08-15T00:00:00.000Z") });
  });
});
