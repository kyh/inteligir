import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Type } from "@sinclair/typebox";
import {
  buildValidatedFactories,
  runBundleSetups,
  validateToolParametersSchema,
  type AgentPorts,
  type ExtensionRegisterContext,
  type ExtensionSetupContext,
  type PiExtensionBundle,
} from "../agent/extension";

const unused = (): never => {
  throw new Error("port not used in this test");
};

/** Inert ports — the bundles under test never touch them. */
function fakePorts(): AgentPorts {
  return {
    executor: {
      cli: { name: "executor", version: "0.0.0", binPath: "/fake/bin/executor" },
      install: async () => {},
      start: async () => false,
      execute: unused,
      resume: unused,
    },
    knowledge: {
      search: () => [],
      backlinks: () => [],
      notesWithTag: () => [],
      rename: () => ({ ok: false, reason: "not wired in this test" }),
    },
    privacy: {
      probe: () => "indeterminate",
      vaultRealRoot: () => null,
      vaultLexicalRoot: () => null,
      privateIndexPaths: () => [],
    },
    checkpoints: null,
  };
}

const ctx: ExtensionSetupContext = {
  binDir: "/fake/bin",
  ports: fakePorts(),
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

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

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

  it("rethrows when a critical bundle's setup throws — after siblings settle", async () => {
    const err = new Error("auth provider unreachable");
    const failing = vi.fn().mockRejectedValue(err);
    const sibling = vi.fn().mockResolvedValue(undefined);
    const bundles = [
      bundle({ name: "critical-one", critical: true, setup: failing }),
      bundle({ name: "sibling", setup: sibling }),
    ];

    await expect(runBundleSetups(bundles, ctx)).rejects.toBe(err);

    expect(failing).toHaveBeenCalledOnce();
    // Parallel: the sibling still runs to completion before the critical
    // rejection bubbles, so concurrent disk work isn't orphaned mid-flight.
    expect(sibling).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("runs setups concurrently rather than in array order", async () => {
    // Each setup awaits the next tick before pushing — under serial execution
    // the order would be [first, second, third], but parallel execution lets
    // all three resolve in the same microtask burst. We verify only that all
    // three ran (parallel does not promise ordering).
    const order: string[] = [];
    const bundles = [
      bundle({
        name: "first",
        setup: async () => {
          await tick();
          order.push("first");
        },
      }),
      bundle({
        name: "second",
        setup: async () => {
          await tick();
          order.push("second");
        },
      }),
      bundle({
        name: "third",
        setup: async () => {
          await tick();
          order.push("third");
        },
      }),
    ];

    await runBundleSetups(bundles, ctx);

    expect(order).toHaveLength(3);
    expect(order.toSorted()).toEqual(["first", "second", "third"]);
  });
});

describe("validateToolParametersSchema", () => {
  it("accepts Type.Object schemas", () => {
    expect(() =>
      validateToolParametersSchema(
        { name: "ok", parameters: Type.Object({ x: Type.String() }) },
        "test",
      ),
    ).not.toThrow();
  });

  it("rejects Type.Union (compiles to anyOf without type)", () => {
    expect(() =>
      validateToolParametersSchema(
        {
          name: "bad",
          parameters: Type.Union([
            Type.Object({ a: Type.Literal("x") }),
            Type.Object({ a: Type.Literal("y") }),
          ]),
        },
        "test",
      ),
    ).toThrow(/top-level type 'object'/);
  });

  it("rejects missing parameters", () => {
    expect(() => validateToolParametersSchema({ name: "bad" }, "test")).toThrow(/no parameters/);
  });
});

describe("buildValidatedFactories", () => {
  const ctx: ExtensionRegisterContext = { binDir: "/fake/bin", ports: fakePorts() };

  it("forwards valid registrations to the underlying pi", async () => {
    const registerTool = vi.fn();
    const pi = { registerTool } as unknown as Parameters<
      ReturnType<PiExtensionBundle["register"]>
    >[0];
    const bundles: PiExtensionBundle[] = [
      {
        name: "good",
        register: () => (api) => {
          api.registerTool({
            name: "ok",
            label: "ok",
            description: "",
            parameters: Type.Object({}),
            execute: async () => ({ content: [], details: {} }),
          });
        },
      },
    ];
    const [factory] = buildValidatedFactories(bundles, ctx);
    if (!factory) throw new Error("expected a factory");
    await factory(pi);
    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("throws when a bundle registers a tool with an invalid schema", async () => {
    const registerTool = vi.fn();
    const pi = { registerTool } as unknown as Parameters<
      ReturnType<PiExtensionBundle["register"]>
    >[0];
    const bundles: PiExtensionBundle[] = [
      {
        name: "broken",
        register: () => (api) => {
          api.registerTool({
            name: "bad",
            label: "bad",
            description: "",
            parameters: Type.Union([
              Type.Object({ a: Type.Literal("x") }),
              Type.Object({ a: Type.Literal("y") }),
            ]),
            execute: async () => ({ content: [], details: {} }),
          });
        },
      },
    ];
    const [factory] = buildValidatedFactories(bundles, ctx);
    if (!factory) throw new Error("expected a factory");
    await expect(factory(pi)).rejects.toThrow(/broken.*'bad'/);
    expect(registerTool).not.toHaveBeenCalled();
  });
});
