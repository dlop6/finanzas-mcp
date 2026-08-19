import { describe, expect, it } from "vitest";
import { parseNonNegativeInteger, parseNonNegativeMoney } from "@/servers/finance-mcp/services";

describe("inventory validation", () => {
  it("accepts non-negative inventory values without converting money to floats", () => {
    expect(parseNonNegativeInteger(0, "Stock")).toBe(0);
    expect(parseNonNegativeMoney("0").toFixed(2)).toBe("0.00");
  });

  it("rejects negative values and non-integer quantities", () => {
    expect(() => parseNonNegativeInteger(-1, "Stock")).toThrow("non-negative");
    expect(() => parseNonNegativeInteger(1.5, "Stock")).toThrow("integer");
    expect(() => parseNonNegativeMoney("-1")).toThrow("non-negative");
  });
});
