import type { ReceivableConfidence, ReceivableStatus } from "@/database/generated/prisma/client";
import type { ReceivableRepository } from "@/servers/finance-mcp/repositories";
import { FinanceDomainError } from "./errors";
import { parseDate, parseMoney, trimDescription } from "./validation";
import { receivableResult, type ReceivableResult } from "./results";
type RecordInput = { description: string; amount: string; expectedDate: string; confidence: ReceivableConfidence };
type ListInput = { status?: ReceivableStatus; confidence?: ReceivableConfidence; dueBefore?: string };
type UpdateInput = { receivableId: number; description?: string; amount?: string; expectedDate?: string; confidence?: ReceivableConfidence };
export class ReceivableService {
  constructor(private readonly receivables: ReceivableRepository) {}
  async recordReceivable(input: RecordInput): Promise<ReceivableResult> { return receivableResult(await this.receivables.create({ description: trimDescription(input.description, true)!, amount: parseMoney(input.amount), expectedDate: parseDate(input.expectedDate, "Expected date"), confidence: input.confidence, status: "PENDING" })); }
  async listReceivables(input: ListInput): Promise<ReceivableResult[]> { return (await this.receivables.list({ ...input, dueBefore: input.dueBefore === undefined ? undefined : parseDate(input.dueBefore, "Expected date") })).map(receivableResult); }
  async updateReceivable(input: UpdateInput): Promise<ReceivableResult> { const update: { description?: string; amount?: ReturnType<typeof parseMoney>; expectedDate?: Date; confidence?: ReceivableConfidence } = {}; if (input.description !== undefined) update.description = trimDescription(input.description)!; if (input.amount !== undefined) update.amount = parseMoney(input.amount); if (input.expectedDate !== undefined) update.expectedDate = parseDate(input.expectedDate, "Expected date"); if (input.confidence !== undefined) update.confidence = input.confidence; if (Object.keys(update).length === 0) throw new FinanceDomainError("At least one field must be provided for update."); return receivableResult(await this.receivables.update(input.receivableId, update)); }
  async markReceivableCollected(receivableId: number): Promise<ReceivableResult> { const receivable = await this.receivables.get(receivableId); return receivableResult(receivable.status === "COLLECTED" ? receivable : await this.receivables.updateStatus(receivableId, "COLLECTED")); }
  async deleteReceivable(receivableId: number): Promise<ReceivableResult> { return receivableResult(await this.receivables.delete(receivableId)); }
}
