/**
 * Pi extension bundle — pairs a pi extension factory with optional one-time
 * setup (binary install, config seed, etc.) so each third-party integration
 * can own its full lifecycle in one module.
 *
 * Bundles are auto-discovered from `./<name>/extension.ts` default exports
 * by setup.ts. setup() and register() receive distinct contexts so each
 * phase only sees what's meaningful at that point in the lifecycle.
 */

import type { ExtensionAPI, ExtensionFactory } from "@repo/pi-driver/pi-types";

import type { SetupProgress } from "@/shared/ipc";

/**
 * Available at agent-start time, every time register() is called. Long-lived
 * paths the running tool may need (e.g. an installed binary location).
 */
export type ExtensionRegisterContext = {
  /** Shared bin dir on PATH for installed CLIs (~/.inteligir/bin). */
  binDir: string;
};

/**
 * Available during onboarding, only inside setup(). Superset of register
 * context — adds bundled-resources access since seeding from packaged assets
 * is a setup-time concern (you can't copy them at agent-start, too late).
 */
export type ExtensionSetupContext = ExtensionRegisterContext & {
  /** Bundled-resources root — packaged assets the extension may copy from. */
  bundledResourcesDir: string;
  /**
   * Report progress to the renderer (onboarding loading bar). Bundles call
   * this around long-running operations (downloads, runtime installs). `percent`
   * is null when the step has no measurable progress.
   */
  onProgress: (progress: SetupProgress) => void;
  /**
   * Re-install even if the pinned version is already present. Set by the
   * "Repair integrations" action; normal onboarding leaves it false so an
   * up-to-date binary is skipped.
   */
  force?: boolean;
};

/** Metadata for a CLI binary a bundle installs, so the UI can show installed-
 *  vs-pinned versions and offer a repair/reinstall. */
type ExtensionCliInfo = {
  /** Display name. */
  name: string;
  /** Pinned version the app ships. */
  version: string;
  /** Absolute path to the installed binary. */
  binPath: string;
};

export type PiExtensionBundle = {
  /** Used for log prefixes and stable sort order. Should match the registered tool name. */
  name: string;
  /** If the bundle installs a CLI binary, declare it here for the integrations UI. */
  cli?: ExtensionCliInfo;
  /**
   * If true, a thrown setup() aborts onboarding (SETUP_FAIL). Default false:
   * setup is best-effort and the tool surfaces its own failure later (e.g.
   * ENOENT when the agent invokes a missing binary).
   */
  critical?: boolean;
  /**
   * One-time setup. Idempotent — runs every SETUP, not just first launch.
   * Omit when the integration is pure in-process (HTTP, in-process API)
   * with nothing to install.
   */
  setup?: (ctx: ExtensionSetupContext) => Promise<void>;
  /**
   * Build a pi ExtensionFactory bound to the given context. Curried so the
   * factory can close over paths (e.g. installed binary location) without
   * the bundle reaching into module-level inteligir helpers.
   */
  register: (ctx: ExtensionRegisterContext) => ExtensionFactory;
};

/**
 * Run each bundle's setup() in order. Non-critical failures log and continue;
 * critical failures rethrow so callers can surface them (e.g. as SETUP_FAIL
 * in the app state machine).
 *
 * Extracted for unit testing — see __tests__/extension.test.ts.
 */
export async function runBundleSetups(
  bundles: PiExtensionBundle[],
  ctx: ExtensionSetupContext,
): Promise<void> {
  for (const bundle of bundles) {
    if (!bundle.setup) continue;
    try {
      await bundle.setup(ctx);
    } catch (err) {
      if (bundle.critical) throw err;
      console.error(`[agent] ${bundle.name} setup failed (continuing):`, err);
    }
  }
}

/**
 * Validate a tool's TypeBox `parameters` schema before pi forwards it to the
 * provider. OpenAI (and most others) require `type: "object"` at the root;
 * TypeBox `Union` / `Intersect` produce `anyOf`/`allOf` with no top-level
 * type, which the provider silently rejects on every turn. Catching this at
 * registration time names the offending tool loudly instead of letting
 * empty turns leak to the user.
 */
export function validateToolParametersSchema(
  tool: { name: string; parameters?: unknown },
  bundleName: string,
): void {
  const params = tool.parameters;
  if (!params || typeof params !== "object") {
    throw new Error(
      `[${bundleName}] tool '${tool.name}' has no parameters schema. ` +
        `Use Type.Object({}) for tools that take no arguments.`,
    );
  }
  const type = (params as { type?: unknown }).type;
  if (type !== "object") {
    throw new Error(
      `[${bundleName}] tool '${tool.name}' parameters schema must have top-level type 'object' ` +
        `(got ${JSON.stringify(type) ?? "undefined"}). ` +
        `TypeBox Union/Intersect produce anyOf/allOf which providers reject — ` +
        `wrap them in Type.Object with a discriminator field and validate per-case at runtime.`,
    );
  }
}

/**
 * Wrap a pi `ExtensionAPI` so every `registerTool` call goes through
 * `validateToolParametersSchema` first. All other methods pass through
 * unchanged.
 */
export function wrapPiWithSchemaValidation(pi: ExtensionAPI, bundleName: string): ExtensionAPI {
  return new Proxy(pi, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "registerTool" && typeof value === "function") {
        return (tool: { name: string; parameters?: unknown }) => {
          validateToolParametersSchema(tool, bundleName);
          return (value as (t: unknown) => unknown).call(target, tool);
        };
      }
      return value;
    },
  });
}

/**
 * Build factory functions that wrap each bundle's pi registration with
 * schema validation. Used by setup.ts when constructing PiAgent.
 */
export function buildValidatedFactories(
  bundles: PiExtensionBundle[],
  ctx: ExtensionRegisterContext,
): ExtensionFactory[] {
  return bundles.map((b) => {
    const factory = b.register(ctx);
    return async (pi: ExtensionAPI) => {
      await factory(wrapPiWithSchemaValidation(pi, b.name));
    };
  });
}
