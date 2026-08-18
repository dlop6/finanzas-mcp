import { describe, expect, it } from "vitest";
import { parseDate, parseMoney, trimDescription } from "@/servers/finance-mcp/services";

describe("financial input validation", () => {
  it("keeps money as Decimal and rejects non-positive or malformed values", () => {
    expect(parseMoney("10.5").toFixed(2)).toBe("10.50");
    expect(() => parseMoney("0")).toThrow("greater than zero");
    expect(() => parseMoney("-1")).toThrow("positive monetary");
  });

  it("accepts only real ISO calendar dates", () => {
    expect(parseDate("2026-08-08").toISOString()).toBe("2026-08-08T00:00:00.000Z");
    expect(() => parseDate("2026-02-30")).toThrow("valid calendar date");
  });

  it("trims descriptions and rejects blank text", () => {
    expect(trimDescription("  note  ")).toBe("note");
    expect(() => trimDescription("   ")).toThrow("must contain text");
  });
});
