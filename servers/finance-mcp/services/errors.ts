import { FinanceRepositoryError } from "@/servers/finance-mcp/repositories";

export class FinanceDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceDomainError";
  }
}

export function isExpectedFinanceError(error: unknown): error is FinanceDomainError | FinanceRepositoryError {
  return error instanceof FinanceDomainError || error instanceof FinanceRepositoryError;
}
