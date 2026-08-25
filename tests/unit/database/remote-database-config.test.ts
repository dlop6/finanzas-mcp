import { describe, expect, it } from "vitest";
import { loadRemoteDatabaseConfig, RemoteDatabaseConfigurationError } from "@/database/remote/config";

const validRemoteUrl = "postgresql://user:password@dpg-example.oregon-postgres.render.com:5432/finanzas?sslmode=require";

describe("remote database configuration", () => {
  it("accepts a direct TLS Render URL without exposing it", () => {
    expect(loadRemoteDatabaseConfig({ DATABASE_URL_REMOTE: validRemoteUrl })).toEqual({ url: validRemoteUrl });
  });

  it.each([
    {},
    { DATABASE_URL_REMOTE: "not-a-url" },
    { DATABASE_URL_REMOTE: "postgresql://user:password@localhost:5432/finanzas?sslmode=require" },
    { DATABASE_URL_REMOTE: "postgresql://user:password@dpg-example.internal/finanzas?sslmode=require" },
    { DATABASE_URL_REMOTE: "postgresql://user:password@dpg-example.oregon-postgres.render.com/finanzas" },
    { DATABASE_URL_REMOTE: validRemoteUrl, DATABASE_URL: validRemoteUrl },
    { DATABASE_URL_REMOTE: validRemoteUrl, TEST_DATABASE_URL: validRemoteUrl },
  ])("rejects unsafe configuration", (environment) => {
    expect(() => loadRemoteDatabaseConfig(environment)).toThrow(RemoteDatabaseConfigurationError);
    expect(() => loadRemoteDatabaseConfig(environment)).toThrow("Remote database configuration is invalid.");
  });
});
