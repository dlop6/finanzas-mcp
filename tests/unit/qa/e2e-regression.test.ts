import { describe, expect, it, vi } from "vitest";
import {
  E2eRegressionError,
  requiredRegressionStages,
  runE2eRegression,
  type RegressionProcess,
} from "@/scripts/qa/e2e-regression";

describe("required E2E regression runner", () => {
  it("runs the mandatory stages in a deterministic order", async () => {
    const runProcess = vi.fn<RegressionProcess>(async () => 0);
    const output: string[] = [];

    await runE2eRegression({ runProcess, output: (line) => output.push(line) });

    expect(runProcess).toHaveBeenCalledTimes(requiredRegressionStages.length);
    expect(runProcess.mock.calls.map(([, args]) => args)).toEqual(requiredRegressionStages.map((stage) => stage.args));
    expect(runProcess.mock.calls.at(-1)?.[2]).toEqual({ NEXT_BUILD_DIST_DIR: ".next-e2e-regression-build" });
    expect(output).toEqual(requiredRegressionStages.flatMap((stage) => [`${stage.name}: running`, `${stage.name}: passed`]));
  });

  it("stops at the first failed stage without reporting command output", async () => {
    const runProcess = vi.fn<RegressionProcess>()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    const output: string[] = [];

    await expect(runE2eRegression({ runProcess, output: (line) => output.push(line) })).rejects.toEqual(
      new E2eRegressionError("General and STDIO tests"),
    );

    expect(runProcess).toHaveBeenCalledTimes(2);
    expect(output).toEqual([
      "Git MCP setup: running",
      "Git MCP setup: passed",
      "General and STDIO tests: running",
    ]);
  });

  it("converts process launch failures to a safe stage error", async () => {
    await expect(runE2eRegression({
      stages: [{ name: "Safe stage", command: "safe", args: [] }],
      runProcess: async () => { throw new Error("https://private.example token=secret"); },
      output: () => undefined,
    })).rejects.toEqual(new E2eRegressionError("Safe stage"));
  });
});
