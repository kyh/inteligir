import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runBundleSetups,
  type ExtensionSetupContext,
  type PiExtensionBundle,
} from "@/agent/extension";

const ctx: ExtensionSetupContext = {
  binDir: "/fake/bin",
  bundledResourcesDir: "/fake/resources",
  onProgress: () => {},
};

function bundle(
  overrides: Partial<PiExtensionBundle> & Pick<PiExtensionBundle, "name">,
): PiExtensionBundle {
  return {
    register: () => () => {},
    ...overrides,
  };
}

describe("runBundleSetups", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("skips bundles without setup", async () => {
    const a = vi.fn<NonNullable<PiExtensionBundle["setup"]>>();
    const bundles = [bundle({ name: "a" }), bundle({ name: "b", setup: a })];

    await runBundleSetups(bundles, ctx);

    expect(a).toHaveBeenCalledOnce();
    expect(a).toHaveBeenCalledWith(ctx);
  });

  it("swallows non-critical setup failures and continues", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("install failed"));
    const succeeding = vi.fn().mockResolvedValue(undefined);
    const bundles = [
      bundle({ name: "broken", setup: failing }),
      bundle({ name: "fine", setup: succeeding }),
    ];

    await expect(runBundleSetups(bundles, ctx)).resolves.toBeUndefined();

    expect(failing).toHaveBeenCalledOnce();
    expect(succeeding).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[agent] broken setup failed (continuing):",
      expect.any(Error),
    );
  });

  it("rethrows when a critical bundle's setup throws", async () => {
    const err = new Error("auth provider unreachable");
    const failing = vi.fn().mockRejectedValue(err);
    const later = vi.fn().mockResolvedValue(undefined);
    const bundles = [
      bundle({ name: "critical-one", critical: true, setup: failing }),
      bundle({ name: "later", setup: later }),
    ];

    await expect(runBundleSetups(bundles, ctx)).rejects.toBe(err);

    expect(failing).toHaveBeenCalledOnce();
    // Halts on critical failure — later bundles do not run.
    expect(later).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("runs setups in array order", async () => {
    const order: string[] = [];
    const bundles = [
      bundle({
        name: "first",
        setup: async () => {
          order.push("first");
        },
      }),
      bundle({
        name: "second",
        setup: async () => {
          order.push("second");
        },
      }),
      bundle({
        name: "third",
        setup: async () => {
          order.push("third");
        },
      }),
    ];

    await runBundleSetups(bundles, ctx);

    expect(order).toEqual(["first", "second", "third"]);
  });
});
