import "dotenv/config";

import { spawn } from "node:child_process";
import { join } from "node:path";
import { getValidatedTestDatabaseUrl } from "../../../database/test/test-database-config";

const root = process.cwd();
const dockerCommand = process.platform === "win32" ? "docker.exe" : "docker";
const nodeCommand = process.execPath;
const prismaCli = join(root, "node_modules", "prisma", "build", "index.js");
const vitestCli = join(root, "node_modules", "vitest", "vitest.mjs");

async function run(command: string, args: string[], env?: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, shell: false, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ?? `code ${code ?? "unknown"}`}`));
    });
  });
}

async function main(): Promise<void> {
  const testDatabaseUrl = getValidatedTestDatabaseUrl();
  const shouldCleanup = true;
  try {
    await run(dockerCommand, ["compose", "--profile", "test", "up", "-d", "--wait", "postgres-test"]);
    const prismaEnv = { DATABASE_URL: testDatabaseUrl, TEST_DATABASE_URL: testDatabaseUrl };
    const vitestEnv = { TEST_DATABASE_URL: testDatabaseUrl };
    await run(nodeCommand, [prismaCli, "generate"], prismaEnv);
    await run(nodeCommand, [prismaCli, "migrate", "deploy"], prismaEnv);
    await run(nodeCommand, [vitestCli, "run", "--config", "vitest.finance.config.mts"], vitestEnv);
  } finally {
    if (shouldCleanup) {
      await run(dockerCommand, ["compose", "--profile", "test", "rm", "-sf", "postgres-test"]);
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Finance integration tests failed";
  console.error(message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted connection]"));
  process.exitCode = 1;
});
