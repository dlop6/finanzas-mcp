import { afterEach, describe, expect, it, vi } from "vitest";
import { getValidatedTestDatabaseUrl } from "@/database/test/test-database-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("finance integration database guard", () => {
  it("accepts only the isolated local database", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://finanzas_mcp:local_dev_only@localhost:5434/finanzas_mcp?schema=public");
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://finanzas_mcp_test:local_test_only@localhost:5435/finanzas_mcp_test?schema=public");
    expect(getValidatedTestDatabaseUrl()).toContain("localhost:5435/finanzas_mcp_test");
  });

  it.each([
    "postgresql://test:pass@localhost:5434/finanzas_mcp_test",
    "postgresql://test:pass@example.com:5435/finanzas_mcp_test",
    "postgresql://test:pass@localhost:5435/other_database",
  ])("rejects an unsafe URL: %s", (url) => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://finanzas_mcp:local_dev_only@localhost:5434/finanzas_mcp");
    vi.stubEnv("TEST_DATABASE_URL", url);
    expect(() => getValidatedTestDatabaseUrl()).toThrow();
  });

  it("rejects production execution", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://test:pass@localhost:5435/finanzas_mcp_test");
    expect(() => getValidatedTestDatabaseUrl()).toThrow("production");
  });
});
