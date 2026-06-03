// Inteligir-specific composition over @repo/pi-driver and @repo/agent-runtime.

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import {
  completeText,
  createAuthStorage,
  hasAuth,
  listSkills as listSkillsFromDisk,
  loginWithProvider,
  PiAgent,
  resolveModel,
  SessionManager,
} from "@repo/pi-driver";
import { prependPath, seedDirectory, seedFile, syncDirectory, syncFile } from "@repo/agent-runtime/seed";
import { readCliVersion } from "@repo/agent-runtime/install";
import open from "open";

import type { ExtensionToolInfo, IntegrationInfo, SetupProgress, SkillInfo } from "@/shared/ipc";
import { inteligirPath } from "@/main/lib/json-store";
import { resetExecutorDaemon } from "@/main/executor/executor-daemon";
import { resetShellCache, resumeShellWrites } from "@/main/shell";
import { resetNotifications } from "@/main/notifications";
import {
  runBundleSetups,
  type ExtensionRegisterContext,
  type ExtensionSetupContext,
  type PiExtensionBundle,
} from "@/agent/extension";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const AUTH_PROVIDER = "openai-codex";
const MODEL_ID = "gpt-5.5";

/**
 * Bump when bundled resources (skills, AGENTS.md, agent defs) change and should
 * be pushed to already-installed users. On a bump, seedResources overwrites the
 * bundled-named files in ~/.inteligir (user-added files are left intact). This
 * does overwrite user edits to those bundled files — the accepted trade-off for
 * delivering updated prompts/skills on upgrade.
 */
const RESOURCE_VERSION = 1;

/** ~/.inteligir — used as pi's agentDir so all discovery looks here */
const AGENT_DIR = inteligirPath();
const AUTH_PATH = inteligirPath("auth.json");
const SESSION_DIR = inteligirPath("sessions");
const WORKSPACE_DIR = inteligirPath("workspace");
const BIN_DIR = inteligirPath("bin");
const EXTENSIONS_DIR = inteligirPath("extensions");

// Override pi-coding-agent's default getAgentDir() (~/.pi/agent)
process.env["PI_CODING_AGENT_DIR"] = AGENT_DIR;

// ---------------------------------------------------------------------------
// Extension bundles — auto-discovered from ./<name>/extension.ts default
// exports. Adding a new extension is "create one folder"; setup.ts never
// needs to be edited. Sorted by bundle name for deterministic registration
// order across builds.
// ---------------------------------------------------------------------------

const bundleModules = import.meta.glob<{ default: PiExtensionBundle }>("./*/extension.ts", {
  eager: true,
});

const EXTENSION_BUNDLES: PiExtensionBundle[] = Object.values(bundleModules)
  .map((m) => m.default)
  .toSorted((a, b) => a.name.localeCompare(b.name));

// ---------------------------------------------------------------------------
// Bundled resource discovery
// ---------------------------------------------------------------------------

declare const PROJECT_ROOT: string;

function getBundledResourcesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "resources", "agent");
  }
  return path.join(PROJECT_ROOT, "resources", "agent");
}

function buildSetupContext(
  onProgress: (p: SetupProgress) => void,
  force = false,
): ExtensionSetupContext {
  return { binDir: BIN_DIR, bundledResourcesDir: getBundledResourcesDir(), onProgress, force };
}

function buildRegisterContext(): ExtensionRegisterContext {
  return { binDir: BIN_DIR };
}

const RESOURCE_VERSION_PATH = inteligirPath(".resources-version");

function readResourceVersion(): number {
  try {
    return Number.parseInt(fs.readFileSync(RESOURCE_VERSION_PATH, "utf8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Copy bundled skills / AGENTS.md / agent defs into ~/.inteligir. Fresh installs
 * and version bumps overwrite the bundled-named files (so upgraded users get new
 * skills and updated prompts); when the on-disk version is already current we
 * fall back to seed-once, which only fills in anything missing without
 * clobbering user edits.
 */
function syncBundledResources(bundledDir: string): void {
  const skillsSrc = path.join(bundledDir, "skills");
  const agentsMdSrc = path.join(bundledDir, "AGENTS.md");
  const agentsSrc = path.join(bundledDir, "agents");
  const skillsDest = path.join(AGENT_DIR, "skills");
  const agentsMdDest = path.join(AGENT_DIR, "AGENTS.md");
  const agentsDest = path.join(AGENT_DIR, "agents");

  // Only enter the overwrite path when ALL bundled sources are present, so a
  // broken/partial bundle never repeatedly clobbers user edits and never marks
  // the version current without a real sync. Gating on existence up front keeps
  // sync-and-record atomic: either every source is overwritten and the version
  // is recorded once, or we fall through to the non-destructive seed-once below.
  const allSourcesPresent =
    fs.existsSync(skillsSrc) && fs.existsSync(agentsMdSrc) && fs.existsSync(agentsSrc);

  if (readResourceVersion() < RESOURCE_VERSION && allSourcesPresent) {
    syncDirectory(skillsSrc, skillsDest);
    syncFile(agentsMdSrc, agentsMdDest);
    syncDirectory(agentsSrc, agentsDest);
    try {
      fs.writeFileSync(RESOURCE_VERSION_PATH, String(RESOURCE_VERSION));
    } catch (err) {
      console.warn("[agent] failed to record resource version:", err);
    }
    return;
  }

  // Up to date (or a bundled source was missing) — only seed what's absent,
  // never overwrite the user's files.
  seedDirectory(skillsSrc, skillsDest);
  seedFile(agentsMdSrc, agentsMdDest);
  seedDirectory(agentsSrc, agentsDest);
}

/**
 * Seed bundled skills + AGENTS.md into ~/.inteligir/ on first run, ensure the
 * bundled CLI bin dir is on PATH so agent tools can find it, and run each
 * extension bundle's setup() (binary install, OAuth seed, etc.).
 *
 * Non-critical bundle setup failures log and continue; a critical bundle's
 * failure throws and surfaces as SETUP_FAIL in the app state machine.
 */
export async function seedResources(onProgress: (p: SetupProgress) => void): Promise<void> {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

  prependPath(BIN_DIR);

  const ctx = buildSetupContext(onProgress);
  if (!fs.existsSync(ctx.bundledResourcesDir)) {
    console.warn("[agent] bundled resources not found at", ctx.bundledResourcesDir);
    return;
  }

  syncBundledResources(ctx.bundledResourcesDir);

  await runBundleSetups(EXTENSION_BUNDLES, ctx);
}

// ---------------------------------------------------------------------------
// Integrations (installed CLI binaries) — list + repair
// ---------------------------------------------------------------------------

/** Report installed-vs-pinned versions for every bundle that installs a CLI. */
export async function listIntegrations(): Promise<IntegrationInfo[]> {
  const clis = EXTENSION_BUNDLES.map((bundle) => bundle.cli).filter(
    (cli): cli is NonNullable<PiExtensionBundle["cli"]> => cli !== undefined,
  );
  return Promise.all(
    clis.map(async (cli) => ({
      name: cli.name,
      expected: cli.version,
      installed: await readCliVersion(cli.binPath),
    })),
  );
}

/**
 * Force-reinstall every CLI binary (repair). Re-runs each bundle's setup() with
 * force=true so up-to-date-but-corrupt binaries are re-downloaded. Reports
 * progress over the same channel as onboarding.
 */
export async function repairIntegrations(onProgress: (p: SetupProgress) => void): Promise<void> {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  await runBundleSetups(EXTENSION_BUNDLES, buildSetupContext(onProgress, true));
  onProgress({ step: "done", percent: null });
}

/**
 * Skills available to the agent, read from disk via pi's own discovery so the
 * list is correct whether or not an agent session is currently running.
 */
export function listSkills(): SkillInfo[] {
  return listSkillsFromDisk({ cwd: WORKSPACE_DIR, agentDir: AGENT_DIR });
}

// Lazy + reset on teardown so a logout flow doesn't carry the prior
// AuthStorage's cached credentials past auth.json being deleted.
let authStorage: ReturnType<typeof createAuthStorage> | null = null;

function getAuthStorage(): ReturnType<typeof createAuthStorage> {
  if (!authStorage) authStorage = createAuthStorage(AUTH_PATH);
  return authStorage;
}

export function isSetupComplete(): boolean {
  return fs.existsSync(WORKSPACE_DIR);
}

export function teardownResources(): void {
  // Drop singletons that hold JsonStore caches BEFORE removing the directory.
  // An in-flight debounced write (e.g. a WidgetViewer's unmount-time flush)
  // running between the rm and the cache reset would otherwise resurrect
  // runtime-ui.json from the warm in-memory shell. With this order, such a
  // write either races against the singleton reset (its write lands before
  // rm and gets wiped) or arrives after the cache is gone.
  authStorage = null;
  resetNotifications();
  resetShellCache();
  resetExecutorDaemon();
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
}

export function isLoggedIn(): boolean {
  if (!fs.existsSync(AUTH_PATH)) return false;
  return hasAuth(getAuthStorage(), AUTH_PROVIDER);
}

export async function login(): Promise<void> {
  await loginWithProvider(getAuthStorage(), AUTH_PROVIDER, {
    onAuth: (info) => {
      void open(info.url);
    },
  });
  // resetShellCache (on a previous logout) suspended shell writes to keep an
  // in-flight setInstanceState from recreating ~/.inteligir. After successful
  // re-auth, the workspace is allowed to materialize again on the next write.
  resumeShellWrites();
}

/**
 * One-shot model completion outside the agent session — used by "live"
 * widget actions that fill UI state from the model without spawning a
 * chat turn. Uses the same model + credentials as the running agent.
 */
export function completeOnce(prompt: string, system?: string): Promise<string> {
  return completeText(getAuthStorage(), resolveModel(AUTH_PROVIDER, MODEL_ID), prompt, system);
}

// ---------------------------------------------------------------------------
// Agent — Inteligir wrapper around PiAgent that fixes paths + extensions and
// exposes the small surface the Electron app needs.
// ---------------------------------------------------------------------------

import type { SessionStatus } from "@/shared/agent";
import type { ImageContent, AgentSessionEvent } from "@repo/pi-driver";

function resolveSessionManager(): SessionManager {
  const sessionFile = process.env["INTELIGIR_SESSION_FILE"];
  if (sessionFile) {
    try {
      return SessionManager.open(sessionFile, SESSION_DIR);
    } catch (err) {
      console.warn("[agent] failed to open session file, falling back to continueRecent:", err);
    }
  }
  return SessionManager.continueRecent(WORKSPACE_DIR, SESSION_DIR);
}

export type AgentOptions = {
  /** If true, start a fresh session instead of resuming the most recent one. */
  newSession?: boolean;
};

export class Agent {
  // Lazy so synchronous resolveModel/resolveSessionManager throws surface
  // through the async start() path rather than out of `new Agent()`.
  private pi: PiAgent | null = null;

  constructor(private readonly opts: AgentOptions = {}) {}

  async start(): Promise<void> {
    if (!this.pi) {
      const sessionManager = this.opts.newSession
        ? SessionManager.create(WORKSPACE_DIR, SESSION_DIR)
        : resolveSessionManager();
      this.pi = new PiAgent({
        cwd: WORKSPACE_DIR,
        agentDir: AGENT_DIR,
        authStorage: getAuthStorage(),
        model: resolveModel(AUTH_PROVIDER, MODEL_ID),
        sessionManager,
        extensionFactories: () => {
          const ctx = buildRegisterContext();
          return EXTENSION_BUNDLES.map((b) => b.register(ctx));
        },
      });
    }
    await this.pi.start();
  }

  async stop(): Promise<void> {
    await this.pi?.stop();
  }

  waitForIdle(timeoutMs: number): Promise<boolean> {
    return this.pi?.waitForIdle(timeoutMs) ?? Promise.resolve(true);
  }

  async sendMessage(message: string, images?: ImageContent[]): Promise<void> {
    await this.ensurePi().sendMessage(message, images);
  }

  async steer(message: string, images?: ImageContent[]): Promise<void> {
    await this.ensurePi().steer(message, images);
  }

  async followUp(message: string, images?: ImageContent[]): Promise<void> {
    await this.ensurePi().followUp(message, images);
  }

  async interrupt(): Promise<boolean> {
    return this.pi?.interrupt() ?? false;
  }

  getState(): { status: SessionStatus; error: string | null } {
    return this.pi?.getState() ?? { status: "starting", error: null };
  }

  getLastAssistantText(): string | undefined {
    return this.pi?.getLastAssistantText();
  }

  listTools(): ExtensionToolInfo[] {
    return this.pi?.listTools() ?? [];
  }

  setActiveTools(toolNames: string[]): void {
    this.pi?.setActiveTools(toolNames);
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    // Throw — silently dropping the listener would mean no agent events
    // ever reach the renderer.
    return this.ensurePi().subscribe(listener);
  }

  private ensurePi(): PiAgent {
    if (!this.pi) throw new Error("Agent not started — call start() first");
    return this.pi;
  }
}
