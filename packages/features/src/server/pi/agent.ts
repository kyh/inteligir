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
import type { Api, AssistantMessage, ImageContent, Model } from "@mariozechner/pi-ai";

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
  extensionFactories: ExtensionFactory[] | (() => ExtensionFactory[] | Promise<ExtensionFactory[]>);
  /** Optional thinking level. Defaults to "off". */
  thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
  /**
   * Built-in pi tool names active at session start (pi's
   * `initialActiveToolNames`; pi's default when omitted is
   * ["read", "bash", "edit", "write"]). Extension-registered tools still
   * activate as they register. Pass an explicit list so the coding-tool
   * surface is a deliberate choice, not a framework default.
   */
  initialActiveToolNames?: string[];
  /**
   * Hard allowlist (pi's `allowedToolNames`): when set, ONLY these tool names
   * exist — extension tools not listed are dropped from the registry, and
   * every listed tool starts active. Takes precedence over
   * `initialActiveToolNames`. Leave unset to keep extension tools available.
   */
  allowedToolNames?: string[];
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
      settingsManager: SettingsManager.create(this.config.cwd, this.config.agentDir),
      // createAgentSession's only public knob is `tools`, which sets BOTH of
      // pi's allowedToolNames (hard registry filter) and initialActiveToolNames.
      // For a bare initialActiveToolNames request we instead pass
      // noTools: "builtin" — zero built-in actives, extension tools still
      // auto-activate as they register — and re-activate the requested
      // built-ins right after creation (below).
      ...(this.config.allowedToolNames !== undefined
        ? { tools: this.config.allowedToolNames }
        : this.config.initialActiveToolNames !== undefined
          ? { noTools: "builtin" as const }
          : {}),
    });

    if (this.config.allowedToolNames === undefined && this.config.initialActiveToolNames) {
      // Extensions registered during createAgentSession are active now; add
      // the explicit built-in set on top. Order matches pi's default
      // (built-ins first, extension tools in registration order).
      session.setActiveToolsByName([
        ...new Set([...this.config.initialActiveToolNames, ...session.getActiveToolNames()]),
      ]);
    }

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
    let unsubscribe: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const ended = new Promise<true>((resolve) => {
      unsubscribe = this.subscribe((event) => {
        if (event.type === "agent_end") resolve(true);
      });
    });
    if (this.status !== "busy") {
      unsubscribe?.();
      return true;
    }
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([ended, timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
      unsubscribe?.();
    }
  }

  // ---- public API ----------------------------------------------------------

  async sendMessage(message: string, images?: ImageContent[]): Promise<void> {
    const session = this.ensureSession();
    const imgs = nonEmpty(images);

    // Race-condition fallback: callers (renderer composer, voice transcripts)
    // gate on their own snapshot of busy state, but the agent may have
    // transitioned to busy by the time the IPC arrives. Route to followUp so
    // pi can queue the message instead of throwing.
    if (this.status === "busy") {
      await session.followUp(message, imgs);
      return;
    }

    this.status = "busy";

    void session.prompt(message, imgs ? { images: imgs } : undefined).catch((err: unknown) => {
      this.error = err instanceof Error ? err.message : String(err);
      console.error("[pi-driver] prompt error:", this.error);
      // Surface the rejection to subscribers — without this the user's
      // message renders as sent while the turn silently never happens (pi
      // only emits events for turns that actually ran). The synthetic
      // agent_end flips status to idle via handleEvent, so set the terminal
      // error status afterwards.
      for (const event of buildPromptFailureEvents(this.config.model, this.error)) {
        this.handleEvent(event);
      }
      this.status = "error";
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

/**
 * Synthetic event sequence emitted to subscribers when `session.prompt()`
 * rejects (the loop never ran or crashed, so pi emitted nothing for the
 * turn). Mirrors pi's own error shape — message_start opens a bubble,
 * message_end with stopReason "error" carries the reason, and agent_end
 * releases any busy-state derived from agent events so the UI can't wedge.
 * Exported for testing the contract with the desktop event parser.
 */
export function buildPromptFailureEvents(model: Model<Api>, reason: string): AgentSessionEvent[] {
  const zeroUsage: AssistantMessage["usage"] = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage,
    stopReason: "error",
    errorMessage: reason,
    timestamp: Date.now(),
  };
  return [
    { type: "message_start", message },
    { type: "message_end", message },
    { type: "agent_end", messages: [message] },
  ];
}
