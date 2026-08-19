import "dotenv/config";

const EXPECTED_DATABASE = "finanzas_mcp_test";
const EXPECTED_PORT = "5435";

export function getValidatedTestDatabaseUrl(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Finance integration tests cannot run in production");
  }

  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL is required for finance integration tests");
  if (testUrl === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must be separate from DATABASE_URL");

  let parsed: URL;
  try {
    parsed = new URL(testUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("TEST_DATABASE_URL must use PostgreSQL");
  }
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("TEST_DATABASE_URL must target a local host");
  }
  if (parsed.port !== EXPECTED_PORT) throw new Error("TEST_DATABASE_URL must use port 5435");
  if (parsed.pathname.replace(/^\//, "") !== EXPECTED_DATABASE) {
    throw new Error("TEST_DATABASE_URL must target finanzas_mcp_test");
  }

  return testUrl;
}

export const testDatabaseName = EXPECTED_DATABASE;
export const testDatabasePort = EXPECTED_PORT;
