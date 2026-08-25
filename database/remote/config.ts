export type RemoteDatabaseEnvironment = Record<string, string | undefined>;

export type RemoteDatabaseConfig = {
  url: string;
};

export class RemoteDatabaseConfigurationError extends Error {
  constructor(public readonly code: "CONFIGURATION_ERROR") {
    super("Remote database configuration is invalid.");
    this.name = "RemoteDatabaseConfigurationError";
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".local");
}

export function loadRemoteDatabaseConfig(environment: RemoteDatabaseEnvironment = process.env): RemoteDatabaseConfig {
  const value = environment.DATABASE_URL_REMOTE?.trim();
  if (!value || value === environment.DATABASE_URL || value === environment.TEST_DATABASE_URL) {
    throw new RemoteDatabaseConfigurationError("CONFIGURATION_ERROR");
  }

  let url: URL;
  try { url = new URL(value); } catch { throw new RemoteDatabaseConfigurationError("CONFIGURATION_ERROR"); }

  const sslMode = url.searchParams.get("sslmode");
  const validSslModes = new Set(["require", "verify-ca", "verify-full"]);
  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    !url.username || !url.password || !url.hostname || !url.pathname || url.pathname === "/" || url.hash ||
    isLocalHost(url.hostname) || !url.hostname.endsWith(".render.com") ||
    (url.port !== "" && url.port !== "5432") || !sslMode || !validSslModes.has(sslMode)
  ) {
    throw new RemoteDatabaseConfigurationError("CONFIGURATION_ERROR");
  }

  return { url: value };
}
