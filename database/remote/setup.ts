import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { seedFinanceDatabase } from "../seed/seed";
import { verifyFinanceSeed } from "../verify";
import { loadRemoteDatabaseConfig, RemoteDatabaseConfigurationError, type RemoteDatabaseConfig } from "./config";

const CONFIRMATION = "INITIALIZE_REMOTE_DATABASE";
const REMOTE_SCHEMA_TABLES = new Set([
  "_prisma_migrations", "Business", "Account", "Category", "Transaction", "FixedExpense", "Debt", "Receivable", "Product", "InventoryMovement",
]);

export class RemoteDatabaseSetupError extends Error {
  constructor(public readonly code: "CONFIGURATION_ERROR" | "CONFIRMATION_REQUIRED" | "MIGRATION_FAILED" | "CONNECTION_FAILED" | "SCHEMA_FAILED" | "SEED_FAILED" | "VERIFICATION_FAILED" | "SETUP_FAILED") {
    super("Remote database setup failed.");
    this.name = "RemoteDatabaseSetupError";
  }
}

export type RemoteDatabaseSetupDependencies = {
  config?: RemoteDatabaseConfig;
  confirm?: () => Promise<boolean>;
  migrate?: (url: string) => Promise<void>;
  createClient?: (url: string) => PrismaClient;
  output?: (message: string) => void;
};

export async function confirmRemoteDatabaseSetup(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const value = await prompt.question(`Type ${CONFIRMATION} to initialize the empty remote database: `);
    return value === CONFIRMATION;
  } finally {
    prompt.close();
  }
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const names = process.platform === "win32"
    ? ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP"]
    : ["PATH", "TMPDIR", "LANG", "LC_ALL"];
  return Object.fromEntries(names.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])) as NodeJS.ProcessEnv;
}

export async function deployRemoteMigrations(url: string): Promise<void> {
  const prismaCli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: process.cwd(), env: { ...safeEnvironment(), DATABASE_URL: url }, shell: false, stdio: "ignore", windowsHide: true,
    });
    child.once("error", () => reject(new RemoteDatabaseSetupError("MIGRATION_FAILED")));
    child.once("close", (code) => code === 0 ? resolve() : reject(new RemoteDatabaseSetupError("MIGRATION_FAILED")));
  });
}

export function createRemoteDatabaseClient(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(url) });
}

async function assertRemoteSchemaIsExpected(client: PrismaClient): Promise<void> {
  const tables = await client.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  if (tables.some(({ table_name }) => !REMOTE_SCHEMA_TABLES.has(table_name))) {
    throw new RemoteDatabaseSetupError("SCHEMA_FAILED");
  }
}

export async function setupRemoteDatabase(dependencies: RemoteDatabaseSetupDependencies = {}): Promise<void> {
  let config: RemoteDatabaseConfig;
  try {
    config = dependencies.config ?? loadRemoteDatabaseConfig();
  } catch (error) {
    if (error instanceof RemoteDatabaseConfigurationError) throw new RemoteDatabaseSetupError("CONFIGURATION_ERROR");
    throw error;
  }
  const confirmed = await (dependencies.confirm ?? confirmRemoteDatabaseSetup)();
  if (!confirmed) throw new RemoteDatabaseSetupError("CONFIRMATION_REQUIRED");

  try {
    await (dependencies.migrate ?? deployRemoteMigrations)(config.url);
    const client = (dependencies.createClient ?? createRemoteDatabaseClient)(config.url);
    try {
      try {
        await client.$connect();
      } catch {
        throw new RemoteDatabaseSetupError("CONNECTION_FAILED");
      }
      try {
        await assertRemoteSchemaIsExpected(client);
      } catch (error) {
        if (error instanceof RemoteDatabaseSetupError) throw error;
        throw new RemoteDatabaseSetupError("SCHEMA_FAILED");
      }
      try {
        await seedFinanceDatabase(client, { target: "remote" });
      } catch {
        throw new RemoteDatabaseSetupError("SEED_FAILED");
      }
      try {
        await verifyFinanceSeed(client);
      } catch {
        throw new RemoteDatabaseSetupError("VERIFICATION_FAILED");
      }
    } finally {
      await client.$disconnect();
    }
  } catch (error) {
    if (error instanceof RemoteDatabaseSetupError) throw error;
    throw new RemoteDatabaseSetupError("SETUP_FAILED");
  }

  const output = dependencies.output ?? ((message: string) => process.stdout.write(`${message}\n`));
  output("Remote database migrations applied.");
  output("Remote financial seed loaded.");
  output("Remote database verification passed.");
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  setupRemoteDatabase().catch((error: unknown) => {
    const code = error instanceof RemoteDatabaseSetupError ? error.code : "SETUP_FAILED";
    process.stderr.write(`Remote database setup failed: ${code}.\n`);
    process.exitCode = 1;
  });
}
