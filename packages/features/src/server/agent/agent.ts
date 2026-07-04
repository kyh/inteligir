// Inteligir's wrapper around PiAgent. Adds:
//   - Lazy construction so synchronous resolveModel/resolveSessionManager
//     failures surface through the async start() path, not from `new Agent()`.
//   - Safe defaults (getState, waitForIdle, interrupt) before start() so the
//     task scheduler can guard cleanly during boot/teardown.
//
// Per-bundle ExtensionFactories are wrapped with schema validation here so
// every registerTool call hits validateToolParametersSchema first (see
// agent/extension.ts).

import { PiAgent } from "@repo/features/server/pi/agent";
import { resolveModel } from "@repo/features/server/pi/model";
import { SessionManager } from "@repo/features/server/pi/pi-types";
import type { AgentSessionEvent, ImageContent } from "@repo/features/server/pi/pi-types";

import { getAuthStorage } from "./auth";
import { EXTENSION_BUNDLES } from "./bundles";
import { buildValidatedFactories, type AgentPorts } from "./extension";
import { AGENT_DIR, AUTH_PROVIDER, MODEL_ID, SESSION_DIR, WORKSPACE_DIR } from "./paths";
import { buildRegisterContext } from "./setup";
import type { SessionStatus } from "@repo/features/agent-events";

/** Pi built-in coding tools the session starts with. Mirrors pi's own default
 * — declared explicitly so the raw system-access surface is a deliberate,
 * auditable choice (see resources/agent/AGENTS.md "System access"). Extension
 * tools (execute, browser, …) activate as they register. */
const INITIAL_ACTIVE_TOOLS = ["read", "bash", "edit", "write"];

function resolveSessionManager(sessionDir: string): SessionManager {
  const sessionFile = process.env["INTELIGIR_SESSION_FILE"];
  if (sessionFile) {
    try {
      return SessionManager.open(sessionFile, sessionDir);
    } catch (err) {
      console.warn("[agent] failed to open session file, falling back to continueRecent:", err);
    }
  }
  return SessionManager.continueRecent(WORKSPACE_DIR, sessionDir);
}

export type AgentOptions = {
  /** Main-owned capabilities (executor) handed to extension bundles at register
   * time. Built main-side by agent-lifecycle.ts. */
  ports: AgentPorts;
  /** If true, start a fresh session instead of resuming the most recent one. */
  newSession?: boolean;
  /** Session directory to read/write. Defaults to SESSION_DIR (the user-facing
   * thread). A separate session dir can be passed to keep a run out of the
   * user's continueRecent pool. */
  sessionDir?: string;
  /** Hard tool allowlist. When set (e.g. `[]`), ONLY these tools exist — used by
   * the inline-AI session, which is a pure text generator with no file/executor
   * access. Unset keeps the default active tool set. */
  allowedToolNames?: string[];
  /** Model id override (must exist in pi-ai's registry for AUTH_PROVIDER).
   * Defaults to MODEL_ID — the ghost-text session passes its fast model. */
  modelId?: string;
  /** Keep the session entirely in memory (never written to disk). Used by the
   * ghost-text session: high-frequency throwaway turns that should neither
   * pile up session files nor be resumable. Takes precedence over
   * newSession/sessionDir. */
  ephemeralSession?: boolean;
};

export class Agent {
  // Lazy so synchronous resolveModel/resolveSessionManager throws surface
  // through the async start() path rather than out of `new Agent()`.
  private pi: PiAgent | null = null;

  constructor(private readonly opts: AgentOptions) {}

  async start(): Promise<void> {
    if (!this.pi) {
      const sessionDir = this.opts.sessionDir ?? SESSION_DIR;
      const sessionManager = this.opts.ephemeralSession
        ? SessionManager.inMemory(WORKSPACE_DIR)
        : this.opts.newSession
          ? SessionManager.create(WORKSPACE_DIR, sessionDir)
          : resolveSessionManager(sessionDir);
      this.pi = new PiAgent({
        cwd: WORKSPACE_DIR,
        agentDir: AGENT_DIR,
        authStorage: getAuthStorage(),
        model: resolveModel(AUTH_PROVIDER, this.opts.modelId ?? MODEL_ID),
        sessionManager,
        // A hard allowlist (even `[]`) replaces the default active-tool set.
        ...(this.opts.allowedToolNames !== undefined
          ? { allowedToolNames: this.opts.allowedToolNames }
          : { initialActiveToolNames: INITIAL_ACTIVE_TOOLS }),
        extensionFactories: () =>
          buildValidatedFactories(EXTENSION_BUNDLES, buildRegisterContext(this.opts.ports)),
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
