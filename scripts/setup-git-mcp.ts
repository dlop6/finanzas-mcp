import { spawn } from "node:child_process";
import { access, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const venvDirectory = resolve(projectRoot, ".venv-git-mcp");
const pythonPath = resolve(venvDirectory, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const demoRepository = resolve(projectRoot, "docs/generated/git-demo");
const requirements = resolve(projectRoot, "requirements/git-mcp.txt");

type Command = { command: string; args: string[] };

function run(command: Command, cwd: string = projectRoot): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command.command, command.args, { cwd, shell: false, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error("Local Git MCP setup failed.")));
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findPython(): Promise<Command> {
  const candidates: Command[] = process.platform === "win32"
    ? [{ command: "py", args: ["-3"] }, { command: "python", args: [] }]
    : [{ command: "python3", args: [] }, { command: "python", args: [] }];

  for (const candidate of candidates) {
    try {
      await run({ ...candidate, args: [...candidate.args, "-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"] });
      return candidate;
    } catch {
      // Try the next known interpreter without exposing local command details.
    }
  }
  throw new Error("Python 3.10 or later is required for the local Git MCP.");
}

async function prepareDemoRepository(): Promise<void> {
  if (await exists(demoRepository)) {
    if (!await exists(resolve(demoRepository, ".git"))) {
      throw new Error("The local Git MCP demo directory is not a Git repository.");
    }
    return;
  }

  await mkdir(demoRepository, { recursive: true });
  await run({ command: "git", args: ["init", "-b", "main"] }, demoRepository);
  await run({ command: "git", args: ["config", "user.name", "Finance MCP Demo"] }, demoRepository);
  await run({ command: "git", args: ["config", "user.email", "demo@local.invalid"] }, demoRepository);
  await run({ command: "git", args: ["commit", "--allow-empty", "-m", "chore: initialize Git MCP demo repository"] }, demoRepository);
}

async function main(): Promise<void> {
  const python = await findPython();
  if (!await exists(pythonPath)) {
    await run({ ...python, args: [...python.args, "-m", "venv", venvDirectory] });
  }
  await stat(requirements);
  await run({ command: pythonPath, args: ["-m", "pip", "install", "--requirement", requirements] });
  await run({ command: pythonPath, args: ["-m", "mcp_server_git", "--help"] });
  await prepareDemoRepository();
  process.stdout.write("Local Git MCP setup completed.\n");
}

void main().catch(() => {
  process.stderr.write("Local Git MCP setup failed.\n");
  process.exitCode = 1;
});
