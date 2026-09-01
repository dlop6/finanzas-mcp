import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export type RegressionStage = {
  name: string;
  command: string;
  args: readonly string[];
  environment?: Readonly<Record<string, string>>;
};

const projectFile = (...segments: string[]) => resolve(process.cwd(), ...segments);

export const requiredRegressionStages: readonly RegressionStage[] = [
  { name: "Git MCP setup", command: process.execPath, args: ["--import", "tsx", projectFile("scripts", "setup-git-mcp.ts")] },
  { name: "General and STDIO tests", command: process.execPath, args: [projectFile("node_modules", "vitest", "vitest.mjs"), "run"] },
  { name: "Finance MCP integration", command: process.execPath, args: ["--import", "tsx", projectFile("tests", "integration", "finance-mcp", "run.ts")] },
  { name: "Finance MCP HTTP integration", command: process.execPath, args: ["--import", "tsx", projectFile("tests", "integration", "finance-mcp", "run-http.ts")] },
  { name: "Git MCP integration", command: process.execPath, args: [projectFile("node_modules", "vitest", "vitest.mjs"), "run", "--config", "vitest.git.config.mts"] },
  { name: "Finance Filesystem Git demo regression", command: process.execPath, args: [projectFile("node_modules", "vitest", "vitest.mjs"), "run", "--config", "vitest.e2e.config.mts"] },
  { name: "Application typecheck", command: process.execPath, args: [projectFile("node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", "tsconfig.json"] },
  { name: "Host typecheck", command: process.execPath, args: [projectFile("node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", "host/tsconfig.json"] },
  { name: "Finance typecheck", command: process.execPath, args: [projectFile("node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", "servers/finance-mcp/tsconfig.json"] },
  { name: "Lint", command: process.execPath, args: [projectFile("node_modules", "eslint", "bin", "eslint.js")] },
  {
    name: "Production build",
    command: process.execPath,
    args: [projectFile("node_modules", "next", "dist", "bin", "next"), "build"],
    environment: { NEXT_BUILD_DIST_DIR: ".next-e2e-regression-build" },
  },
];

export type RegressionProcess = (command: string, args: readonly string[], environment?: Readonly<Record<string, string>>) => Promise<number | null>;

export class E2eRegressionError extends Error {
  constructor(public readonly stage: string) {
    super(`E2E regression failed: ${stage}.`);
    this.name = "E2eRegressionError";
  }
}

async function executeProcess(command: string, args: readonly string[], environment: Readonly<Record<string, string>> = {}): Promise<number | null> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, [...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...environment },
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolveResult(code));
  });
}

export async function runE2eRegression(options: {
  stages?: readonly RegressionStage[];
  runProcess?: RegressionProcess;
  output?: (line: string) => void;
} = {}): Promise<void> {
  const stages = options.stages ?? requiredRegressionStages;
  const runProcess = options.runProcess ?? executeProcess;
  const output = options.output ?? ((line: string) => process.stdout.write(`${line}\n`));

  for (const stage of stages) {
    output(`${stage.name}: running`);
    let exitCode: number | null;
    try {
      exitCode = await runProcess(stage.command, stage.args, stage.environment);
    } catch {
      throw new E2eRegressionError(stage.name);
    }
    if (exitCode !== 0) {
      throw new E2eRegressionError(stage.name);
    }
    output(`${stage.name}: passed`);
  }
}

async function main(): Promise<void> {
  try {
    await runE2eRegression();
    process.stdout.write("Required E2E regression: passed\n");
  } catch (error) {
    if (error instanceof E2eRegressionError) {
      process.stderr.write(`Required E2E regression: failed at ${error.stage}.\n`);
    } else {
      process.stderr.write("Required E2E regression: failed.\n");
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
