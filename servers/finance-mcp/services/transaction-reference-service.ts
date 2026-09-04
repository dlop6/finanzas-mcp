import type { TransactionType } from "@/database/generated/prisma/client";
import type { BusinessRepository } from "@/servers/finance-mcp/repositories";

export type TransactionReferenceData = {
  currency: "GTQ";
  accounts: Array<{ id: number; name: string; type: "CASH" | "BANK" }>;
  categories: Array<{ id: number; name: string; type: "INCOME" | "EXPENSE" }>;
};

/** Provides the minimum stable business labels needed to prepare a transaction. */
export class TransactionReferenceService {
  constructor(private readonly business: BusinessRepository) {}

  async getReferenceData(type: TransactionType): Promise<TransactionReferenceData> {
    const [activeBusiness, accounts, categories] = await Promise.all([
      this.business.getActiveBusiness(),
      this.business.listAccounts(),
      this.business.listCategories(type),
    ]);

    return {
      currency: activeBusiness.currency as "GTQ",
      accounts: accounts.map(({ id, name, type: accountType }) => ({ id, name, type: accountType })),
      categories: categories.map(({ id, name, type: categoryType }) => ({ id, name, type: categoryType })),
    };
  }
}
