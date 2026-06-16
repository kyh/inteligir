// AgentHost — the Electron-free lifecycle wrapper around @repo/pi-driver's
// PiAgent. It owns session resolution and the public agent surface
// (sendMessage/steer/interrupt/subscribe/...), but takes everything
// environment-specific (paths, auth, model, extension factories) as injected
// config. The desktop app subclasses this with its ~/.inteligir paths and its
// ports-coupled extension factories; a future cloud runner injects a
// container-local home and its own factories — same core, different deployment.
//
// The host treats extensionFactories as opaque (same shape PiAgent accepts), so
// it stays decoupled from however a consumer builds/validates its bundles — the
// desktop's main-owned "ports" framework lives entirely in apps/desktop/agent.

import type { Api, Model } from "@mariozechner/pi-ai";

import { PiAgent } from "@repo/pi-driver/agent";
import { SessionManager } from "@repo/pi-driver/pi-types";
import type {
  AgentSessionEvent,
  AuthStorage,
  ExtensionFactory,
  ImageContent,
} from "@repo/pi-driver/pi-types";

export type AgentHostStatus = "starting" | "idle" | "busy" | "error";

export type AgentHostConfig = {
  /** Working directory the agent operates against. */
  cwd: string;
  /** pi agentDir (skills, AGENTS.md, etc.). */
  agentDir: string;
  /** Directory for persisted session transcripts. */
  sessionDir: string;
  /**
   * AuthStorage for credential lookup. A thunk so a synchronous failure (or
   * heavy construction) is deferred to start() rather than the constructor.
   */
  authStorage: () => AuthStorage;
  /** Default model for new sessions. A thunk for the same reason as authStorage. */
  model: () => Model<Api>;
  /**
   * Extensions to register at session start. May be a function so consumers can
   * defer building factories (and any heavy imports they pull in) to start().
   * Passed through to PiAgent unchanged — the host doesn't inspect them.
   */
  extensionFactories: ExtensionFactory[] | (() => ExtensionFactory[] | Promise<ExtensionFactory[]>);
  /** Tool names active when the session starts (pi's default applies if unset). */
  initialActiveToolNames?: string[];
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
        authStorage: this.config.authStorage(),
        model: this.config.model(),
        sessionManager,
        extensionFactories: this.config.extensionFactories,
        // Spread optionals only when set — exactOptionalPropertyTypes rejects
        // passing an explicit `undefined` to an optional PiAgent field.
        ...(this.config.initialActiveToolNames !== undefined
          ? { initialActiveToolNames: this.config.initialActiveToolNames }
          : {}),
        ...(this.config.thinkingLevel !== undefined
          ? { thinkingLevel: this.config.thinkingLevel }
          : {}),
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
