/**
 * Pi extension bundle — pairs a pi extension factory with optional one-time
 * setup (binary install, config seed, etc.) so each third-party integration
 * can own its full lifecycle in one module.
 *
 * Bundles are registered explicitly in bundles.ts (`./<name>/extension.ts`
 * default exports). setup() and register() receive distinct contexts so each
 * phase only sees what's meaningful at that point in the lifecycle.
 */

import type { ExtensionAPI, ExtensionFactory } from "@repo/agent/pi/pi-types";
import type { SearchResult } from "@repo/notes/knowledge/knowledge-index";
import type {
  BacklinkEntry,
  ForwardLinkEntry,
  VaultTaskEntry,
  WikiTarget,
} from "@repo/notes/knowledge/link-graph-index";
import type { RelatedNoteEntry } from "@repo/notes/knowledge/related-notes";
import type { TagCount } from "@repo/notes/knowledge/tag-index";
import type { SyncStatus } from "@repo/notes/sync/status";

import { isRecord } from "@repo/bridge/wire-helpers";
import type { Delegation } from "@repo/bridge/delegation";
import type {
  NotePrivacyProbe,
  SetupProgress,
  VaultEntry,
  VaultFileFacts,
} from "@repo/bridge/ipc-registry";
import type { ExecutorExecuteResult } from "@repo/bridge/executor";

// ---------------------------------------------------------------------------
// Ports — host-owned capabilities handed to extensions at register/setup time.
// agent/ never imports the host — @repo/agent has no dep edge on
// @repo/server (a package fact); @repo/server's boot/agent-wiring.ts builds
// these (structural subsets of the host singletons) and passes them down.
// The dependency direction stays one-way: the host composes, agent receives.
//
// The agent reads/writes vault files through the `./vault` workspace symlink
// using pi's native file tools, so there is no vault port — only capabilities
// that can't be expressed as plain filesystem access need one.
// ---------------------------------------------------------------------------

/** Executor daemon access (@repo/connectors/*): install, lifecycle, code mode.
 *
 * `signal` on execute/resume is OPTIONAL on purpose: it carries pi's per-tool
 * abort so a user interrupt doesn't wait out the executor's 600s execution
 * timeout, and an implementation that ignores it stays type-compatible. The
 * host implementation composes it with the client's own timeout signal
 * (AbortSignal.any) rather than replacing it — the timeout is a separate
 * guarantee from the interrupt. */
export type ExecutorPort = {
  /** Pinned CLI metadata for the integrations UI. */
  cli: ExtensionCliInfo;
  install(force?: boolean): Promise<void>;
  /** Ensure the daemon is up. Resolves false when it's unavailable. */
  start(): Promise<boolean>;
  execute(code: string, signal?: AbortSignal): Promise<ExecutorExecuteResult>;
  resume(
    executionId: string,
    action: "accept" | "decline" | "cancel",
    content?: unknown,
    signal?: AbortSignal,
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
 * (boot/agent-knowledge-port.ts) excludes private at the index AND re-probes
 * every survivor against live disk, closing the index-lag TOCTOU. */
export type KnowledgePort = {
  search(query: string, limit?: number): SearchResult[];
  backlinks(path: string): BacklinkEntry[];
  /** The note's OUTGOING links, RESOLVED to vault paths. The agent's file
   * tools see `[[link]]` as text; which file that text points at is a
   * question only the index can answer (alias-aware, shadow-qualified,
   * extension-less), so it needs a port. A dangling link keeps
   * `targetPath: null` — an unresolved link is a real state, not an error.
   * Same silent privacy rule as backlinks: a private subject reads as "no
   * links", and an entry whose resolved target isn't public right now is
   * dropped without annotation. */
  forwardLinks(path: string): ForwardLinkEntry[];
  /** Ranked related notes (shared link targets, co-citation, shared tags,
   * lexical similarity) with human-readable `reasons` — NOT raw forward
   * links. Same silent privacy rule as backlinks: a private subject reads
   * as "no related notes", private candidates never appear. */
  relatedNotes(path: string): RelatedNoteEntry[];
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
 * Built host-side in boot/agent-wiring.ts over the live Vault/Knowledge
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
 * agent's undo point (the host's restore/restore-manager.ts behind it). The tool
 * gate invokes it strictly after privacy allows a call and strictly before pi
 * executes the tool. MUST throw when capture fails: the gate handler lets the
 * throw propagate and pi converts it into an error tool result, blocking the
 * write — an AI edit with no undo point must never happen (the same rule
 * delegation's pre-run snapshot enforces). */
export type AgentCheckpointPort = {
  capture(target: VaultDocWrite): void;
};

// ---------------------------------------------------------------------------
// AgentVaultPort — the WHOLE-VAULT and host-state reads (the read-projected
// tier of @repo/bridge/agent-grants). Method names mirror the bridge methods
// they project, so a grant row reads as one method ↔ one projection and a
// method with no projection is visibly ungranted.
//
// The type lives here and the implementation host-side
// (server boot/agent-knowledge-port.ts) for KnowledgePort's reason: agent/
// never imports the host. Same privacy contract as KnowledgePort — index
// prefilter plus a live-disk re-probe of every survivor, dropping silently.
// ---------------------------------------------------------------------------

/** A page request: the FIRST `limit` rows in the projection's own order, with
 * no cursor past them — `folder` (a vault-relative prefix; "" or absent = the
 * whole vault) is the only way to reach what falls beyond. `limit` is clamped
 * host-side: the privacy re-probe is a file read per row, so an unbounded page
 * would read the whole vault. */
export type AgentListingOpts = { limit?: number | undefined; folder?: string | undefined };

/** A refused port call — one model-safe sentence to relay verbatim. Reads and
 * mutations share it: a sweep too big to run and a private note are both
 * answers the model states, never exceptions it guesses at. */
export type AgentRefusal = { ok: false; reason: string };

/** The two whole-corpus sweeps. They report numbers over the WHOLE vault
 * (counts, totals, degrees), so a truncated window would be a wrong number
 * rather than a short page — there is nothing to paginate, only a size past
 * which the sweep refuses. */
export type AgentTagsResult = { ok: true; tags: TagCount[] } | AgentRefusal;
export type AgentLinkGraphResult = { ok: true; graph: AgentLinkGraph } | AgentRefusal;

/** A well-connected note. `degree` counts note-to-note edges over the graph
 * the caller was handed, so it means "connections you can see". */
export type AgentGraphHub = { path: string; title: string; degree: number };

/** One connected component. `size` is its true size; `members` is a capped
 * sample of it, so `size > members.length` is ordinary. */
export type AgentGraphCluster = { size: number; members: string[] };

/** The DERIVED graph answer — never the raw node/edge blob, which is tens of
 * megabytes of JSON on a large vault and unreadable to a model anyway. */
export type AgentLinkGraph = {
  totalNotes: number;
  /** Connections between two visible notes; self-links excluded. */
  totalLinks: number;
  /** Notes with no resolved link to another note, either direction (sample). */
  orphans: string[];
  hubs: AgentGraphHub[];
  clusters: AgentGraphCluster[];
};

/** Sync status minus the free-form failure message: a host error string
 * routinely embeds the coordinator URL or a vault path, there is no way to
 * sanitize an arbitrary message, and a model can act on a network error
 * either way. So it reports THAT the last pass failed, not why. */
export type AgentSyncStatus =
  | Extract<SyncStatus, { phase: "idle" | "syncing" | "ok" }>
  | { phase: "held"; deletions: number; baseCount: number; sample: string[] }
  | { phase: "error" };

export type AgentSyncState = {
  enabled: boolean;
  status: AgentSyncStatus;
  /** Vault paths of unresolved conflict COPIES, privacy-filtered. */
  conflicts: string[];
};

/** One delegation as the model may see it — built field by field host-side,
 * never the Bridge's `Delegation` whole, so a field that record grows next
 * cannot reach the model with no code change and no failing type. */
export type AgentDelegation = {
  id: string;
  sourceFile: string;
  /** The delegated `- [ ] …` line, from a note that reads public NOW. */
  lineText: string;
  status: Delegation["status"];
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  resultSummary: string | null;
  error: string | null;
};

export type AgentVaultPort = {
  listVault(opts?: AgentListingOpts): VaultEntry[];
  readVaultDoc(path: string): string | null;
  getVaultFileFacts(path: string): VaultFileFacts | null;
  listVaultTasks(opts?: AgentListingOpts): VaultTaskEntry[];
  listTags(): AgentTagsResult;
  listWikiTargets(opts?: AgentListingOpts): WikiTarget[];
  getLinkGraph(): AgentLinkGraphResult;
  getSyncState(): AgentSyncState;
  listDelegations(): AgentDelegation[];
};

// ---------------------------------------------------------------------------
// AgentActionPort — the three MUTATING tiers (write-checkpointed, delegate,
// destructive-confirmed). Every method answers with a VALUE: a refusal is a
// result the model reads and relays, never a throw, so a private note or a
// declined confirmation reads the same way a stale line does.
//
// The confirmation for the destructive pair is raised INSIDE the host
// implementation rather than by the calling tool — same shape as the HTML-app
// broker's `confirmRemove` hook, one level down, so no tool can forget to ask.
// ---------------------------------------------------------------------------

export type AgentToggleTaskResult = { ok: true; checked: boolean } | AgentRefusal;
export type AgentDelegateResult = { ok: true; id: string; lineText: string } | AgentRefusal;
export type AgentDeleteResult = { ok: true; trashed: boolean } | AgentRefusal;
export type AgentActionOk = { ok: true } | AgentRefusal;

export type AgentActionPort = {
  /** Tick/untick one checkbox, keyed by ordinal AND the exact recorded line.
   * Captures a restore point before writing (fail-closed: no capture, no
   * write) and refuses a note that is private on live disk. */
  toggleTask(path: string, ordinal: number, expectedRaw: string): AgentToggleTaskResult;
  /** Hand one checkbox to the background agent. */
  delegateTask(path: string, ordinal: number): AgentDelegateResult;
  cancelDelegation(id: string): AgentActionOk;
  /** Propose rewinding the note a finished delegation edited to its pre-run
   * bytes — the same whole-file overwrite as undoMyEdit, so it asks the user
   * too. A decline is a refusal value. */
  restoreDelegation(id: string): Promise<AgentActionOk>;
  /** Propose trashing a file. Asks the user; a decline is a refusal value. */
  deleteNote(path: string): Promise<AgentDeleteResult>;
  /** Propose undoing the agent's most recent captured edit to one note, from
   * the CURRENT conversation only. Asks the user. */
  undoMyEdit(path: string): Promise<AgentActionOk>;
};

export type AgentPorts = {
  executor: ExecutorPort;
  knowledge: KnowledgePort;
  vault: AgentVaultPort;
  /** null on sessions nobody is watching — the background delegation/routine
   * agent. Two of the three mutating tiers make no sense unattended: a
   * destructive proposal has no human in the conversation to answer it (it
   * would expire as a decline), and an agent that can delegate its own work
   * to itself has no stopping condition. The reads stay; the tools that need
   * this port simply do not register. */
  actions: AgentActionPort | null;
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
