import type { McpCallToolResult } from "@/shared/mcp";
import type { HostMcpToolRegistry, RegisteredMcpTool } from "@/host/orchestration/mcp-tool-registry";

export const WEB_DASHBOARD_LOG_SESSION_ID = "WEB_DASHBOARD";
export const WEB_DASHBOARD_TIME_ZONE = "America/Guatemala" as const;

export type DashboardSectionError = {
  code: "TOOL_FAILED" | "INVALID_TOOL_RESPONSE";
  message: string;
};

export type DashboardSection<T> =
  | { status: "ready"; data: T }
  | { status: "error"; error: DashboardSectionError };

export type DashboardAccount = {
  id: number;
  name: string;
  type: "CASH" | "BANK";
  initialBalance: string;
  income: string;
  expenses: string;
  balance: string;
};

export type DashboardBalance = {
  currency: string;
  currentBalance: string;
  accounts: DashboardAccount[];
};

export type DashboardMonthlyCashFlow = {
  currency: string;
  startDate: string;
  endDate: string;
  income: string;
  expenses: string;
};

export type DashboardReceivable = {
  id: number;
  description: string;
  amount: string;
  expectedDate: string;
  confidence: "CONFIRMED" | "UNCONFIRMED";
};

export type DashboardReceivables = { currency: string; items: DashboardReceivable[] };

export type DashboardDebt = {
  id: number;
  description: string;
  amount: string;
  dueDate: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
};

export type DashboardDebts = { currency: string; items: DashboardDebt[] };

export type DashboardProjection = {
  currency: string;
  asOfDate: string;
  throughDate: string;
  horizonDays: 7 | 30;
  currentBalance: string;
  confirmedReceivables: string;
  unconfirmedReceivables: string;
  fixedExpenses: string;
  pendingDebts: string;
  safeProjectedBalance: string;
  potentialProjectedBalance: string;
};

export type DashboardProduct = {
  id: number;
  name: string;
  stock: number;
  unitCost: string;
  salePrice: string;
  minimumStock: number;
};

export type DashboardLowStock = { currency: string; items: DashboardProduct[] };

export type WebFinancialDashboardResponse = {
  status: "ready" | "partial";
  generatedAt: string;
  timezone: typeof WEB_DASHBOARD_TIME_ZONE;
  period: { startDate: string; endDate: string; debtDueThrough: string };
  balance: DashboardSection<DashboardBalance>;
  monthlyCashFlow: DashboardSection<DashboardMonthlyCashFlow>;
  receivables: DashboardSection<DashboardReceivables>;
  debts: DashboardSection<DashboardDebts>;
  projections: {
    sevenDays: DashboardSection<DashboardProjection>;
    thirtyDays: DashboardSection<DashboardProjection>;
  };
  lowStock: DashboardSection<DashboardLowStock>;
};

export type DashboardClock = { now(): Date };
export const systemDashboardClock: DashboardClock = { now: () => new Date() };

export type DashboardPeriod = { startDate: string; endDate: string; debtDueThrough: string };

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const moneyPattern = /^-?\d+\.\d{2}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function money(value: unknown): string | undefined {
  const candidate = string(value);
  return candidate !== undefined && moneyPattern.test(candidate) ? candidate : undefined;
}

function date(value: unknown): string | undefined {
  const candidate = string(value);
  return candidate !== undefined && datePattern.test(candidate) ? candidate : undefined;
}

function stringEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined;
}

function asCurrency(value: Record<string, unknown>): string | undefined {
  const currency = string(value.currency);
  return currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined;
}

function dashboardError(code: DashboardSectionError["code"]): DashboardSectionError {
  return {
    code,
    message: code === "TOOL_FAILED"
      ? "No se pudo obtener esta información."
      : "La información recibida no tiene el formato esperado.",
  };
}

function errorSection<T>(code: DashboardSectionError["code"]): DashboardSection<T> {
  return { status: "error", error: dashboardError(code) };
}

function partsInGuatemala(value: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WEB_DASHBOARD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const find = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  return { year: find("year"), month: find("month"), day: find("day") };
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Uses UTC date-only arithmetic after extracting the Guatemala civil date. */
export function getDashboardPeriod(clock: DashboardClock = systemDashboardClock): DashboardPeriod {
  const { year, month, day } = partsInGuatemala(clock.now());
  const due = new Date(Date.UTC(year, month - 1, day));
  due.setUTCDate(due.getUTCDate() + 30);
  return {
    startDate: formatDateParts(year, month, 1),
    endDate: formatDateParts(year, month, day),
    debtDueThrough: formatDateParts(due.getUTCFullYear(), due.getUTCMonth() + 1, due.getUTCDate()),
  };
}

function structuredResult(result: McpCallToolResult): Record<string, unknown> | undefined {
  return result.isError ? undefined : record(result.structuredContent);
}

function account(value: unknown): DashboardAccount | undefined {
  const item = record(value);
  if (!item) return undefined;
  const id = integer(item.id);
  const name = string(item.name);
  const type = stringEnum(item.type, ["CASH", "BANK"] as const);
  const initialBalance = money(item.initialBalance);
  const income = money(item.income);
  const expenses = money(item.expenses);
  const balance = money(item.balance);
  return id === undefined || !name || !type || !initialBalance || !income || !expenses || !balance
    ? undefined
    : { id, name, type, initialBalance, income, expenses, balance };
}

function receivable(value: unknown): DashboardReceivable | undefined {
  const item = record(value);
  if (!item) return undefined;
  const id = integer(item.id);
  const description = string(item.description);
  const amount = money(item.amount);
  const expectedDate = date(item.expectedDate);
  const confidence = stringEnum(item.confidence, ["CONFIRMED", "UNCONFIRMED"] as const);
  return id === undefined || !description || !amount || !expectedDate || !confidence
    ? undefined
    : { id, description, amount, expectedDate, confidence };
}

function debt(value: unknown): DashboardDebt | undefined {
  const item = record(value);
  if (!item) return undefined;
  const id = integer(item.id);
  const description = string(item.description);
  const amount = money(item.amount);
  const dueDate = date(item.dueDate);
  const priority = stringEnum(item.priority, ["LOW", "MEDIUM", "HIGH"] as const);
  return id === undefined || !description || !amount || !dueDate || !priority
    ? undefined
    : { id, description, amount, dueDate, priority };
}

function product(value: unknown): DashboardProduct | undefined {
  const item = record(value);
  if (!item) return undefined;
  const id = integer(item.id);
  const name = string(item.name);
  const stock = integer(item.stock);
  const unitCost = money(item.unitCost);
  const salePrice = money(item.salePrice);
  const minimumStock = integer(item.minimumStock);
  return id === undefined || !name || stock === undefined || !unitCost || !salePrice || minimumStock === undefined
    ? undefined
    : { id, name, stock, unitCost, salePrice, minimumStock };
}

function items<T>(value: unknown, mapper: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.map(mapper);
  return result.some((item) => item === undefined) ? undefined : result as T[];
}

function parseBalance(result: McpCallToolResult): DashboardBalance | undefined {
  const value = structuredResult(result);
  if (!value) return undefined;
  const currency = asCurrency(value);
  const currentBalance = money(value.currentBalance);
  const accounts = items(value.accounts, account);
  return !currency || !currentBalance || !accounts ? undefined : { currency, currentBalance, accounts };
}

function parseMonthlyCashFlow(result: McpCallToolResult): DashboardMonthlyCashFlow | undefined {
  const value = structuredResult(result);
  if (!value) return undefined;
  const currency = asCurrency(value);
  const startDate = date(value.startDate);
  const endDate = date(value.endDate);
  const income = money(value.income);
  const expenses = money(value.expenses);
  return !currency || !startDate || !endDate || !income || !expenses ? undefined : { currency, startDate, endDate, income, expenses };
}

function parseReceivables(result: McpCallToolResult): DashboardReceivables | undefined {
  const value = structuredResult(result);
  if (!value) return undefined;
  const currency = asCurrency(value);
  const list = items(value.receivables, receivable);
  return !currency || !list ? undefined : { currency, items: list };
}

function parseDebts(result: McpCallToolResult): DashboardDebts | undefined {
  const value = structuredResult(result);
  if (!value) return undefined;
  const currency = asCurrency(value);
  const list = items(value.debts, debt);
  return !currency || !list ? undefined : { currency, items: list };
}

function parseProjection(result: McpCallToolResult, horizonDays: 7 | 30): DashboardProjection | undefined {
  const value = structuredResult(result);
  if (!value) return undefined;
  const currency = asCurrency(value);
  const asOfDate = date(value.asOfDate);
  const throughDate = date(value.throughDate);
  const actualHorizon = value.horizonDays === horizonDays ? horizonDays : undefined;
  const currentBalance = money(value.currentBalance);
  const confirmedReceivables = money(value.confirmedReceivables);
  const unconfirmedReceivables = money(value.unconfirmedReceivables);
  const fixedExpenses = money(value.fixedExpenses);
  const pendingDebts = money(value.pendingDebts);
  const safeProjectedBalance = money(value.safeProjectedBalance);
  const potentialProjectedBalance = money(value.potentialProjectedBalance);
  return !currency || !asOfDate || !throughDate || !actualHorizon || !currentBalance || !confirmedReceivables
    || !unconfirmedReceivables || !fixedExpenses || !pendingDebts || !safeProjectedBalance || !potentialProjectedBalance
    ? undefined
    : { currency, asOfDate, throughDate, horizonDays: actualHorizon, currentBalance, confirmedReceivables, unconfirmedReceivables, fixedExpenses, pendingDebts, safeProjectedBalance, potentialProjectedBalance };
}

function parseLowStock(result: McpCallToolResult): DashboardLowStock | undefined {
  const value = structuredResult(result);
  if (!value) return undefined;
  const currency = asCurrency(value);
  const list = items(value.products, product);
  return !currency || !list ? undefined : { currency, items: list };
}

async function readTool(registry: HostMcpToolRegistry, name: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
  let tool: RegisteredMcpTool;
  try {
    tool = registry.resolve(name);
  } catch {
    throw new Error("tool unavailable");
  }
  // The dashboard is restricted to discovered Finance read tools, not direct Finance services or reconstructed calculations.
  if (tool.serverId !== "finance-mcp" || tool.isWriteOperation) throw new Error("tool unavailable");
  return tool.client.toolsCall(name, structuredClone(args), { sessionId: WEB_DASHBOARD_LOG_SESSION_ID });
}

async function section<T>(
  operation: () => Promise<McpCallToolResult>,
  parser: (result: McpCallToolResult) => T | undefined,
): Promise<DashboardSection<T>> {
  try {
    const result = await operation();
    const parsed = parser(result);
    return parsed === undefined ? errorSection("INVALID_TOOL_RESPONSE") : { status: "ready", data: structuredClone(parsed) };
  } catch {
    return errorSection("TOOL_FAILED");
  }
}

export type WebFinancialDashboardService = {
  getDashboard(): Promise<WebFinancialDashboardResponse>;
};

export function createWebFinancialDashboardService(options: {
  registry: HostMcpToolRegistry;
  clock?: DashboardClock;
}): WebFinancialDashboardService {
  const clock = options.clock ?? systemDashboardClock;
  return {
    async getDashboard(): Promise<WebFinancialDashboardResponse> {
      const period = getDashboardPeriod(clock);
      // Independent reads start together so one unavailable section does not delay the remaining dashboard data.
      const [balance, monthlyCashFlow, receivables, debts, sevenDays, thirtyDays, lowStock] = await Promise.all([
        section(() => readTool(options.registry, "get_current_balance", {}), parseBalance),
        section(() => readTool(options.registry, "get_cash_flow_summary", { startDate: period.startDate, endDate: period.endDate }), parseMonthlyCashFlow),
        section(() => readTool(options.registry, "list_receivables", { status: "PENDING" }), parseReceivables),
        section(() => readTool(options.registry, "list_debts", { status: "PENDING", dueBefore: period.debtDueThrough }), parseDebts),
        section(() => readTool(options.registry, "project_cash_flow", { horizonDays: 7 }), (result) => parseProjection(result, 7)),
        section(() => readTool(options.registry, "project_cash_flow", { horizonDays: 30 }), (result) => parseProjection(result, 30)),
        section(() => readTool(options.registry, "list_low_stock_products", {}), parseLowStock),
      ]);
      const sections = [balance, monthlyCashFlow, receivables, debts, sevenDays, thirtyDays, lowStock];
      if (sections.every((item) => item.status === "error")) throw new WebFinancialDashboardError("DASHBOARD_FAILED");
      return {
        status: sections.some((item) => item.status === "error") ? "partial" : "ready",
        generatedAt: clock.now().toISOString(),
        timezone: WEB_DASHBOARD_TIME_ZONE,
        period,
        balance,
        monthlyCashFlow,
        receivables,
        debts,
        projections: { sevenDays, thirtyDays },
        lowStock,
      };
    },
  };
}

export class WebFinancialDashboardError extends Error {
  constructor(public readonly code: "DASHBOARD_FAILED", message = "Financial dashboard data is unavailable.") {
    super(message);
    this.name = "WebFinancialDashboardError";
  }
}
