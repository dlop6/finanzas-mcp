import { describe, expect, it, vi } from "vitest";
import { createWebFinanceRuntime, WebHostRuntimeManager, type WebHostRuntime } from "@/host/web";

function runtime(close = vi.fn(async () => undefined)): WebHostRuntime {
  return {
    sessionChat: {} as WebHostRuntime["sessionChat"],
    registry: {} as WebHostRuntime["registry"],
    interactionLogs: {} as WebHostRuntime["interactionLogs"],
    financeClient: {} as WebHostRuntime["financeClient"],
    dashboard: {} as WebHostRuntime["dashboard"],
    close,
  };
}

describe("WebHostRuntimeManager", () => {
  it("exposes a Finance-only runtime factory", () => {
    expect(createWebFinanceRuntime).toBeTypeOf("function");
  });

  it("shares one initialization between concurrent callers and closes it once", async () => {
    const close = vi.fn(async () => undefined);
    const start = vi.fn(async () => runtime(close));
    const manager = new WebHostRuntimeManager(start);

    const [first, second] = await Promise.all([manager.get(), manager.get()]);

    expect(first).toBe(second);
    expect(start).toHaveBeenCalledOnce();
    await manager.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("clears a failed initialization so a later request can recover", async () => {
    const start = vi.fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(runtime());
    const manager = new WebHostRuntimeManager(start);

    await expect(manager.get()).rejects.toThrow("unavailable");
    await expect(manager.get()).resolves.toMatchObject({ sessionChat: {} });
    expect(start).toHaveBeenCalledTimes(2);
  });
});
