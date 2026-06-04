// Inteligir's wrapper around PiAgent. Adds:
//   - Lazy construction so synchronous resolveModel/resolveSessionManager
//     failures surface through the async start() path, not from `new Agent()`.
//   - Safe defaults (getState, waitForIdle, interrupt) before start() so the
//     task scheduler can guard cleanly during boot/teardown.
//
// Per-bundle ExtensionFactories are wrapped with schema validation here so
// every registerTool call hits validateToolParametersSchema first (see
// agent/extension.ts).

import { PiAgent } from "@repo/pi-driver/agent";
import { resolveModel } from "@repo/pi-driver/model";
import { SessionManager } from "@repo/pi-driver/pi-types";
import type { AgentSessionEvent, ImageContent } from "@repo/pi-driver/pi-types";

import { getAuthStorage } from "@/agent/auth";
import { buildValidatedFactories } from "@/agent/extension";
import { AGENT_DIR, AUTH_PROVIDER, MODEL_ID, SESSION_DIR, WORKSPACE_DIR } from "@/agent/paths";
import { EXTENSION_BUNDLES, buildRegisterContext } from "@/agent/setup";
import type { SessionStatus } from "@/shared/agent";

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
        extensionFactories: () => buildValidatedFactories(EXTENSION_BUNDLES, buildRegisterContext()),
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
