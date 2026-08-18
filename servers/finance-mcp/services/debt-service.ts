import type { DebtPriority, DebtStatus } from "@/database/generated/prisma/client";
import type { DebtRepository } from "@/servers/finance-mcp/repositories";
import { debtResult, type DebtResult } from "./results";
import { FinanceDomainError } from "./errors";
import { parseDate, parseMoney, trimDescription } from "./validation";

type RecordInput = { description: string; amount: string; dueDate: string; priority: DebtPriority };
type ListInput = { status?: DebtStatus; priority?: DebtPriority; dueBefore?: string };
type UpdateInput = { debtId: number; description?: string; amount?: string; dueDate?: string; priority?: DebtPriority };
export class DebtService {
  constructor(private readonly debts: DebtRepository) {}
  async recordDebt(input: RecordInput): Promise<DebtResult> { return debtResult(await this.debts.create({ description: trimDescription(input.description, true)!, amount: parseMoney(input.amount), dueDate: parseDate(input.dueDate, "Due date"), priority: input.priority, status: "PENDING" })); }
  async listDebts(input: ListInput): Promise<DebtResult[]> { return (await this.debts.list({ ...input, dueBefore: input.dueBefore === undefined ? undefined : parseDate(input.dueBefore, "Due date") })).map(debtResult); }
  async updateDebt(input: UpdateInput): Promise<DebtResult> {
    const update: { description?: string; amount?: ReturnType<typeof parseMoney>; dueDate?: Date; priority?: DebtPriority } = {};
    if (input.description !== undefined) update.description = trimDescription(input.description)!;
    if (input.amount !== undefined) update.amount = parseMoney(input.amount);
    if (input.dueDate !== undefined) update.dueDate = parseDate(input.dueDate, "Due date");
    if (input.priority !== undefined) update.priority = input.priority;
    if (Object.keys(update).length === 0) throw new FinanceDomainError("At least one field must be provided for update.");
    return debtResult(await this.debts.update(input.debtId, update));
  }
  async markDebtPaid(debtId: number): Promise<DebtResult> { const debt = await this.debts.get(debtId); return debtResult(debt.status === "PAID" ? debt : await this.debts.updateStatus(debtId, "PAID")); }
  async deleteDebt(debtId: number): Promise<DebtResult> { return debtResult(await this.debts.delete(debtId)); }
}
