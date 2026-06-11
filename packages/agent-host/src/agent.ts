// AgentHost — the Electron-free lifecycle wrapper around @repo/pi-driver's
// PiAgent. It owns session resolution, extension-factory validation, and the
// public agent surface (sendMessage/steer/interrupt/subscribe/...), but takes
// everything environment-specific (paths, auth, model, extension bundles) as
// injected config. The desktop app subclasses this with its ~/.inteligir paths
// and Electron-coupled bundles; a future cloud runner injects headless bundles
// and a container-local home — same core, different deployment.

import { PiAgent } from "@repo/pi-driver/agent";
import { SessionManager } from "@repo/pi-driver/pi-types";
import type {
  AgentSessionEvent,
  Api,
  AuthStorage,
  ImageContent,
  Model,
} from "@repo/pi-driver/pi-types";

import {
  buildValidatedFactories,
  type ExtensionRegisterContext,
  type PiExtensionBundle,
} from "@repo/agent-host/extension";

/** A value, or a thunk producing it — lets callers defer construction to start(). */
type Lazy<T> = T | (() => T);

function resolveLazy<T>(value: Lazy<T>): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

export type AgentHostStatus = "starting" | "idle" | "busy" | "error";

export type AgentHostConfig = {
  /** Working directory the agent operates against. */
  cwd: string;
  /** pi agentDir (skills, AGENTS.md, etc.). */
  agentDir: string;
  /** Directory for persisted session transcripts. */
  sessionDir: string;
  /**
   * AuthStorage for credential lookup. Lazy so a synchronous failure surfaces
   * through start() rather than out of the constructor.
   */
  authStorage: Lazy<AuthStorage>;
  /** Default model for new sessions. Lazy for the same reason as authStorage. */
  model: Lazy<Model<Api>>;
  /** Extension bundles to register at session start. */
  bundles: Lazy<PiExtensionBundle[]>;
  /** Context passed to each bundle's register(). */
  registerContext: Lazy<ExtensionRegisterContext>;
  /**
   * Start a fresh session instead of resuming the most recent one. When
   * resuming, the INTELIGIR_SESSION_FILE env var (read at start()) can pin a
   * specific session file instead of continueRecent.
   */
  newSession?: boolean;
  /** Optional thinking level. Defaults to "off". */
  thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
};

export class AgentHost {
  // Lazy so synchronous model/session-manager failures surface through the
  // async start() path rather than out of the constructor.
  protected pi: PiAgent | null = null;

  constructor(protected readonly config: AgentHostConfig) {}

  async start(): Promise<void> {
    if (!this.pi) {
      const sessionManager = this.config.newSession
        ? SessionManager.create(this.config.cwd, this.config.sessionDir)
        : this.resolveSessionManager();
      this.pi = new PiAgent({
        cwd: this.config.cwd,
        agentDir: this.config.agentDir,
        authStorage: resolveLazy(this.config.authStorage),
        model: resolveLazy(this.config.model),
        sessionManager,
        extensionFactories: () =>
          buildValidatedFactories(
            resolveLazy(this.config.bundles),
            resolveLazy(this.config.registerContext),
          ),
        thinkingLevel: this.config.thinkingLevel,
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

  getState(): { status: AgentHostStatus; error: string | null } {
    return this.pi?.getState() ?? { status: "starting", error: null };
  }

  getLastAssistantText(): string | undefined {
    return this.pi?.getLastAssistantText();
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    // Throw — silently dropping the listener would mean no agent events ever
    // reach the consumer's surface (renderer, dispatch relay, etc.).
    return this.ensurePi().subscribe(listener);
  }

  private resolveSessionManager(): SessionManager {
    const sessionFile = process.env["INTELIGIR_SESSION_FILE"];
    if (sessionFile) {
      try {
        return SessionManager.open(sessionFile, this.config.sessionDir);
      } catch (err) {
        console.warn(
          "[agent-host] failed to open session file, falling back to continueRecent:",
          err,
        );
      }
    }
    return SessionManager.continueRecent(this.config.cwd, this.config.sessionDir);
  }

  private ensurePi(): PiAgent {
    if (!this.pi) throw new Error("AgentHost not started — call start() first");
    return this.pi;
  }
}
