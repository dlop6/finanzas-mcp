import { Prisma } from "@/database/generated/prisma/client";
import { FinanceDomainError } from "./errors";

export const MONEY_PATTERN = "^(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,2})?$";
export const MONEY_REGEXP = new RegExp(MONEY_PATTERN);
const DATE_REGEXP = /^\d{4}-\d{2}-\d{2}$/;

export function parseMoney(value: string): Prisma.Decimal {
  if (!MONEY_REGEXP.test(value)) throw new FinanceDomainError("Amount must be a positive monetary string.");
  const amount = new Prisma.Decimal(value);
  if (!amount.greaterThan(0)) throw new FinanceDomainError("Amount must be greater than zero.");
  return amount;
}

export function parseNonNegativeMoney(value: string): Prisma.Decimal {
  if (!MONEY_REGEXP.test(value)) throw new FinanceDomainError("Amount must be a non-negative monetary string.");
  const amount = new Prisma.Decimal(value);
  if (amount.lessThan(0)) throw new FinanceDomainError("Amount must be non-negative.");
  return amount;
}

export function parseNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value)) throw new FinanceDomainError(`${field} must be an integer.`);
  if (value < 0) throw new FinanceDomainError(`${field} must be non-negative.`);
  return value;
}

export function parsePositiveInteger(value: number, field: string): number {
  const parsed = parseNonNegativeInteger(value, field);
  if (parsed === 0) throw new FinanceDomainError(`${field} must be greater than zero.`);
  return parsed;
}

export function parseDate(value: string, field = "Date"): Date {
  if (!DATE_REGEXP.test(value)) throw new FinanceDomainError(`${field} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new FinanceDomainError(`${field} must be a valid calendar date.`);
  }
  return date;
}

export function trimDescription(value: string, required = false): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (required) throw new FinanceDomainError("Description must contain text.");
    throw new FinanceDomainError("Description must contain text when provided.");
  }
  return trimmed;
}

export function formatMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
