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
import { prependPath, seedDirectory, seedFile } from "@repo/agent-runtime/seed";
import open from "open";

import type { ExtensionToolInfo, SetupProgress, SkillInfo } from "@/shared/ipc";
import { inteligirPath } from "@/main/lib/json-store";
import { resetShellCache } from "@/main/shell";
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
  .sort((a, b) => a.name.localeCompare(b.name));

// ---------------------------------------------------------------------------
// Bundled resource discovery
// ---------------------------------------------------------------------------

declare const __PROJECT_ROOT__: string;

function getBundledResourcesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "resources", "agent");
  }
  return path.join(__PROJECT_ROOT__, "resources", "agent");
}

function buildSetupContext(onProgress: (p: SetupProgress) => void): ExtensionSetupContext {
  return { binDir: BIN_DIR, bundledResourcesDir: getBundledResourcesDir(), onProgress };
}

function buildRegisterContext(): ExtensionRegisterContext {
  return { binDir: BIN_DIR };
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

  seedDirectory(path.join(ctx.bundledResourcesDir, "skills"), path.join(AGENT_DIR, "skills"));
  seedFile(path.join(ctx.bundledResourcesDir, "AGENTS.md"), path.join(AGENT_DIR, "AGENTS.md"));

  await runBundleSetups(EXTENSION_BUNDLES, ctx);
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
let _authStorage: ReturnType<typeof createAuthStorage> | null = null;

function getAuthStorage(): ReturnType<typeof createAuthStorage> {
  if (!_authStorage) _authStorage = createAuthStorage(AUTH_PATH);
  return _authStorage;
}

export function isSetupComplete(): boolean {
  return fs.existsSync(WORKSPACE_DIR);
}

export function teardownResources(): void {
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
  // Drop singletons that hold JsonStore caches pointing at files inside
  // AGENT_DIR — otherwise a re-login would serve stale settings until the
  // process restarts.
  _authStorage = null;
  resetNotifications();
  resetShellCache();
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
}

/**
 * One-shot model completion outside the agent session — used by "live"
 * artifact actions that fill UI state from the model without spawning a
 * chat turn. Uses the same model + credentials as the running agent.
 */
export function completeOnce(prompt: string, system?: string): Promise<string> {
  return completeText(getAuthStorage(), resolveModel(AUTH_PROVIDER, MODEL_ID), prompt, system);
}

// ---------------------------------------------------------------------------
// Agent — Inteligir wrapper around PiAgent that fixes paths + extensions and
// keeps the legacy public surface app code expects (sendMessage returning
// SendMessageResult, listTools returning ExtensionToolInfo[]).
// ---------------------------------------------------------------------------

import type {
  InterruptResult,
  SendMessageResult,
  SteerResult,
  SessionStatus,
} from "@/shared/agent";
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

  async sendMessage(message: string, images?: ImageContent[]): Promise<SendMessageResult> {
    await this.ensurePi().sendMessage(message, images);
    return { accepted: true };
  }

  async steer(message: string, images?: ImageContent[]): Promise<SteerResult> {
    await this.ensurePi().steer(message, images);
    return { accepted: true };
  }

  async followUp(message: string, images?: ImageContent[]): Promise<SendMessageResult> {
    await this.ensurePi().followUp(message, images);
    return { accepted: true };
  }

  async interrupt(): Promise<InterruptResult> {
    if (!this.pi) return { interrupted: false };
    const interrupted = await this.pi.interrupt();
    return { interrupted };
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
