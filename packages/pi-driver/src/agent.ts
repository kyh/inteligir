import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type {
  AgentSession,
  AgentSessionEvent,
  AuthStorage,
  ExtensionFactory,
} from "@mariozechner/pi-coding-agent";
import type { Api, ImageContent, Model } from "@mariozechner/pi-ai";

export type PiAgentStatus = "starting" | "idle" | "busy" | "error";

export type PiAgentEventListener = (event: AgentSessionEvent) => void;

/** Plain projection of pi's `ToolInfo` so callers can serialize over IPC. */
export type PiAgentTool = {
  name: string;
  description: string;
  source: string;
  active: boolean;
};

export type PiAgentConfig = {
  /** Working directory the agent operates against. */
  cwd: string;
  /** Directory where pi keeps its agent-specific state (skills, AGENTS.md, etc). */
  agentDir: string;
  /** AuthStorage for credential lookup. */
  authStorage: AuthStorage;
  /** Default model for new sessions. */
  model: Model<Api>;
  /** SessionManager strategy (e.g. continueRecent, open specific file, inMemory). */
  sessionManager: SessionManager;
  /**
   * Extensions to register at session start. May be passed as a function so
   * callers can defer dynamic imports (e.g. extensions that pull in heavy
   * native deps) until `start()` is invoked.
   */
  extensionFactories:
    | ExtensionFactory[]
    | (() => ExtensionFactory[] | Promise<ExtensionFactory[]>);
  /** Optional thinking level. Defaults to "off". */
  thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
};

/** Lifecycle wrapper around pi-coding-agent's AgentSession. */
export class PiAgent {
  private session: AgentSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<PiAgentEventListener>();
  private status: PiAgentStatus = "starting";
  private error: string | null = null;

  constructor(private readonly config: PiAgentConfig) {}

  // ---- lifecycle -----------------------------------------------------------

  async start(): Promise<void> {
    if (this.session) return;

    const modelRegistry = ModelRegistry.create(this.config.authStorage);

    const factories =
      typeof this.config.extensionFactories === "function"
        ? await this.config.extensionFactories()
        : this.config.extensionFactories;

    const resourceLoader = new DefaultResourceLoader({
      cwd: this.config.cwd,
      agentDir: this.config.agentDir,
      extensionFactories: factories,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: this.config.cwd,
      agentDir: this.config.agentDir,
      authStorage: this.config.authStorage,
      modelRegistry,
      resourceLoader,
      model: this.config.model,
      thinkingLevel: this.config.thinkingLevel ?? "off",
      sessionManager: this.config.sessionManager,
      settingsManager: SettingsManager.create(
        this.config.cwd,
        this.config.agentDir,
      ),
    });

    this.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      this.handleEvent(event);
    });

    this.session = session;
    this.status = "idle";
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;

    if (this.session) {
      await this.session.abort();
      this.session.dispose();
      this.session = null;
    }

    this.status = "starting";
    this.error = null;
  }

  /**
   * Resolve once the agent transitions back to idle, or after `timeoutMs`
   * elapses. Returns true if the agent finished within the timeout.
   *
   * Subscribes BEFORE the status check so we can't miss an `agent_end`
   * that fires between reading status and registering the listener.
   */
  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!this.session) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let unsub: (() => void) | undefined;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        unsub?.();
        resolve(value);
      };
      unsub = this.subscribe((event) => {
        if (event.type === "agent_end") settle(true);
      });
      if (this.status !== "busy") {
        settle(true);
        return;
      }
      timer = setTimeout(() => settle(false), timeoutMs);
    });
  }

  // ---- public API ----------------------------------------------------------

  async sendMessage(message: string, images?: ImageContent[]): Promise<void> {
    const session = this.ensureSession();
    const imgs = nonEmpty(images);

    if (this.status === "busy") {
      await session.followUp(message, imgs);
      return;
    }

    this.status = "busy";

    void session
      .prompt(message, imgs ? { images: imgs } : undefined)
      .catch((err: unknown) => {
        this.status = "error";
        this.error = err instanceof Error ? err.message : String(err);
        console.error("[pi-driver] prompt error:", this.error);
      });
  }

  async steer(message: string, images?: ImageContent[]): Promise<void> {
    await this.ensureSession().steer(message, nonEmpty(images));
  }

  async followUp(message: string, images?: ImageContent[]): Promise<void> {
    await this.ensureSession().followUp(message, nonEmpty(images));
  }

  async interrupt(): Promise<boolean> {
    if (!this.session) return false;
    await this.session.abort();
    return true;
  }

  getState(): { status: PiAgentStatus; error: string | null } {
    return { status: this.status, error: this.error };
  }

  getLastAssistantText(): string | undefined {
    return this.session?.getLastAssistantText();
  }

  // ---- tools / extensions --------------------------------------------------

  listTools(): PiAgentTool[] {
    if (!this.session) return [];
    const all = this.session.getAllTools();
    const active = new Set(this.session.getActiveToolNames());
    return all.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      source: t.sourceInfo.source,
      active: active.has(t.name),
    }));
  }

  setActiveTools(toolNames: string[]): void {
    this.session?.setActiveToolsByName(toolNames);
  }

  // ---- subscriptions -------------------------------------------------------

  subscribe(listener: PiAgentEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---- internals -----------------------------------------------------------

  private handleEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case "agent_start":
        this.status = "busy";
        break;
      case "agent_end":
        this.status = "idle";
        break;
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* swallow — one bad listener shouldn't take down the rest */
      }
    }
  }

  private ensureSession(): AgentSession {
    if (!this.session) {
      throw new Error("PiAgent not started — call start() first");
    }
    return this.session;
  }
}

/** Empty array → undefined so prompt/steer/followUp behave identically. */
function nonEmpty(images: ImageContent[] | undefined): ImageContent[] | undefined {
  return images && images.length > 0 ? images : undefined;
}
