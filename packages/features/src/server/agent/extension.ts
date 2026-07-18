/**
 * Pi extension bundle — pairs a pi extension factory with optional one-time
 * setup (binary install, config seed, etc.) so each third-party integration
 * can own its full lifecycle in one module.
 *
 * Bundles are registered explicitly in bundles.ts (`./<name>/extension.ts`
 * default exports). setup() and register() receive distinct contexts so each
 * phase only sees what's meaningful at that point in the lifecycle.
 */

import type { ExtensionAPI, ExtensionFactory } from "@repo/features/server/pi/pi-types";
import type { SearchResult } from "@repo/core/knowledge/knowledge-index";
import type { BacklinkEntry } from "@repo/core/knowledge/link-graph-index";

import { isRecord } from "@repo/features/ipc";
import type { NotePrivacyProbe, SetupProgress } from "@repo/features/ipc-registry";
import type { ExecutorExecuteResult } from "@repo/features/executor";

// ---------------------------------------------------------------------------
// Ports — main-owned capabilities handed to extensions at register/setup time.
// agent/ never imports @/main/*; main/lib/agent-lifecycle.ts builds these
// (structural subsets of the main singletons) and passes them down. The
// dependency direction stays one-way: main composes, agent receives.
//
// The agent reads/writes vault files through the `./vault` workspace symlink
// using pi's native file tools, so there is no vault port — only capabilities
// that can't be expressed as plain filesystem access need one.
// ---------------------------------------------------------------------------

/** Executor daemon access (main/executor/*): install, lifecycle, code mode. */
export type ExecutorPort = {
  /** Pinned CLI metadata for the integrations UI. */
  cli: ExtensionCliInfo;
  install(force?: boolean): Promise<void>;
  /** Ensure the daemon is up. Resolves false when it's unavailable. */
  start(): Promise<boolean>;
  execute(code: string): Promise<ExecutorExecuteResult>;
  resume(
    executionId: string,
    action: "accept" | "decline" | "cancel",
    content?: unknown,
  ): Promise<ExecutorExecuteResult>;
};

/** Knowledge-engine access (derived indexes live OUTSIDE the vault, so the
 * agent's file tools can't reach them — hence a port). Read-only queries plus
 * `rename` — the one mutation, and it exists precisely because the agent's
 * raw file tools CAN move a file but can't rewrite the vault's links to it.
 *
 * PRIVACY CONTRACT: results are privacy-FILTERED — a `private: true` note
 * never appears (no path, no snippet; a private backlinks target reads as
 * "no backlinks", indistinguishable from none). The implementation
 * (lib/agent-knowledge-port.ts) excludes private at the index AND re-probes
 * every survivor against live disk, closing the index-lag TOCTOU. */
export type KnowledgePort = {
  search(query: string, limit?: number): SearchResult[];
  backlinks(path: string): BacklinkEntry[];
  /** Vault paths of notes carrying a tag (case-insensitive). */
  notesWithTag(tag: string): string[];
  /** Rename/move a vault file through the SAME pipeline the user-facing
   * renameVaultEntry handler runs: note-name gate on the destination
   * basename, then snapshot-verified vault-wide link rewrite + old-title
   * alias recording (knowledge/rename-rewrite.ts). Refusals are VALUES,
   * never throws (guarded-edit style). */
  rename(from: string, to: string): RenameNoteResult;
};

/** KnowledgePort.rename outcome. `linksRewritten` counts the NOTES whose
 * links were rewritten to follow the move (0 when nothing pointed at the
 * file, or when wiki-links were already location-independent). A failure
 * `reason` is one model-safe sentence: invalid destination name, missing
 * source, occupied destination, or a private/unreadable source. */
export type RenameNoteResult =
  | { ok: true; from: string; to: string; linksRewritten: number }
  | { ok: false; reason: string };

/** A note's live-disk privacy verdict: notePrivacy's three states plus
 * `absent` (no such file). Anything that can't be read/typed probes
 * `indeterminate` — the gate treats it as private (fail-closed). The SAME
 * union the vault:probe-note-privacy channel carries — one probe contract,
 * host and renderer side. */
export type PrivacyProbe = NotePrivacyProbe;

/** Vault-privacy capability behind the agent tool gate (privacy/extension.ts).
 * Built host-side in agent-lifecycle.ts over the live Vault/Knowledge
 * singletons; the gate itself stays a pure decision core. */
export type PrivacyPort = {
  /** LIVE disk frontmatter probe for a vault-relative path — never the index. */
  probe(rel: string): PrivacyProbe;
  /** realpath of the vault root, or null when it can't be resolved — the gate
   * then FAILS CLOSED for anything vault-shaped rather than allowing it. */
  vaultRealRoot(): string | null;
  /** The configured root, lexically resolved (no fs) — the fail-closed
   * fallback prefix used only while vaultRealRoot is null. */
  vaultLexicalRoot(): string | null;
  /** Indexed private note paths (vault-relative) — the PREFILTER feeding the
   * best-effort bash/execute heuristics and directory-scan checks. Lags the
   * index debounce; file tools never rely on it (they probe live). */
  privateIndexPaths(): string[];
};

/** A pi `edit`/`write` whose parity-resolved target is an in-vault markdown
 * doc — the checkpoint seam's capture coordinate (privacy/gate.ts
 * classifyVaultDocWrite produces it). `rel` is vault-relative. */
export type VaultDocWrite = { rel: string; tool: "edit" | "write" };

/** Pre-write checkpoint capture for ALLOWED in-vault doc mutations — the chat
 * agent's undo point (checkpoints/checkpoint-manager.ts behind it). The tool
 * gate invokes it strictly after privacy allows a call and strictly before pi
 * executes the tool. MUST throw when capture fails: the gate handler lets the
 * throw propagate and pi converts it into an error tool result, blocking the
 * write — an AI edit with no undo point must never happen (the same rule
 * delegation's pre-run snapshot enforces). */
export type AgentCheckpointPort = {
  capture(target: VaultDocWrite): void;
};

export type AgentPorts = {
  executor: ExecutorPort;
  knowledge: KnowledgePort;
  privacy: PrivacyPort;
  /** null on sessions whose writes must not feed the chat undo surface: the
   * background delegation agent (its target-file undo is the pre-run
   * delegation snapshot + the dock's "Restore original"; hook captures there
   * would surface nowhere). Sessions without file tools never invoke it. */
  checkpoints: AgentCheckpointPort | null;
};

/**
 * Available at agent-start time, every time register() is called. Long-lived
 * paths the running tool may need (e.g. an installed binary location) plus
 * the main-owned ports extensions act through.
 */
export type ExtensionRegisterContext = {
  /** Shared bin dir on PATH for installed CLIs (~/.inteligir/bin). */
  binDir: string;
  ports: AgentPorts;
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
export type ExtensionCliInfo = {
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
  /**
   * If the bundle installs a CLI binary, declare it here for the integrations
   * UI. The function form is for bundles whose CLI is main-owned (executor) —
   * the pinned metadata arrives through ports instead of a static import.
   */
  cli?: ExtensionCliInfo | ((ports: AgentPorts) => ExtensionCliInfo);
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

/** Resolve a bundle's CLI metadata, evaluating the port-derived form. */
export function resolveBundleCli(
  bundle: PiExtensionBundle,
  ports: AgentPorts,
): ExtensionCliInfo | undefined {
  return typeof bundle.cli === "function" ? bundle.cli(ports) : bundle.cli;
}

/**
 * Run each bundle's setup() in parallel. Non-critical failures log and
 * continue; a critical bundle's failure rethrows after every other bundle
 * has settled, so we surface it as SETUP_FAIL without orphaning concurrent
 * disk writes mid-flight.
 *
 * Parallel is safe because each bundle owns its own bin path / config slot
 * and they don't share mutable state across setup(). The wall-clock win is
 * the ~150–500ms cold-cache `--version` execs the bundles run in series
 * otherwise, plus any download stages that would have stacked.
 *
 * Extracted for unit testing — see __tests__/extension.test.ts.
 */
export async function runBundleSetups(
  bundles: PiExtensionBundle[],
  ctx: ExtensionSetupContext,
): Promise<void> {
  const results = await Promise.allSettled(
    bundles
      .filter((bundle) => bundle.setup !== undefined)
      .map(async (bundle) => {
        try {
          await bundle.setup?.(ctx);
        } catch (err) {
          if (bundle.critical) throw err;
          console.error(`[agent] ${bundle.name} setup failed (continuing):`, err);
        }
      }),
  );
  // Surface the first critical failure (if any) — bundles that returned
  // successfully or whose non-critical errors were swallowed above don't
  // produce a "rejected" result, so any rejection here is a critical throw.
  const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (firstFailure) {
    const reason: unknown = firstFailure.reason;
    throw reason instanceof Error ? reason : new Error(String(reason));
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
  const params: unknown = tool.parameters;
  if (!isRecord(params)) {
    throw new Error(
      `[${bundleName}] tool '${tool.name}' has no parameters schema. ` +
        `Use Type.Object({}) for tools that take no arguments.`,
    );
  }
  const type = params["type"];
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
function wrapPiWithSchemaValidation(pi: ExtensionAPI, bundleName: string): ExtensionAPI {
  return new Proxy(pi, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "registerTool" && typeof value === "function") {
        const registerTool = value.bind(target);
        return (tool: { name: string; parameters?: unknown }) => {
          validateToolParametersSchema(tool, bundleName);
          return registerTool(tool);
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
