import "dotenv/config";

import { spawn } from "node:child_process";
import { join } from "node:path";
import { getValidatedTestDatabaseUrl } from "../../../database/test/test-database-config";

const root = process.cwd();
const dockerCommand = process.platform === "win32" ? "docker.exe" : "docker";
const prismaCli = join(root, "node_modules", "prisma", "build", "index.js");
const vitestCli = join(root, "node_modules", "vitest", "vitest.mjs");

async function run(command: string, args: string[], environment?: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...environment }, shell: false, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error("Finance HTTP integration tests failed.")));
  });
}

async function main(): Promise<void> {
  const url = getValidatedTestDatabaseUrl();
  try {
    await run(dockerCommand, ["compose", "--profile", "test", "up", "-d", "--wait", "postgres-test"]);
    await run(process.execPath, [prismaCli, "generate"], { DATABASE_URL: url, TEST_DATABASE_URL: url });
    await run(process.execPath, [prismaCli, "migrate", "deploy"], { DATABASE_URL: url, TEST_DATABASE_URL: url });
    await run(process.execPath, [vitestCli, "run", "--config", "vitest.finance-http.config.mts"], { TEST_DATABASE_URL: url });
  } finally {
    await run(dockerCommand, ["compose", "--profile", "test", "rm", "-sf", "postgres-test"]);
  }
}

main().catch(() => { console.error("Finance HTTP integration tests failed."); process.exitCode = 1; });
