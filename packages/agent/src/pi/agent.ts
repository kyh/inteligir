import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionFactory,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { Api, AssistantMessage, ImageContent, Model } from "@earendil-works/pi-ai";
import { toErrorMessage } from "@repo/bridge/wire-helpers";

import { prepareRuntimeForSelection, resolveModelSelection, type ModelSelection } from "./model";

export type PiAgentStatus = "starting" | "idle" | "busy" | "error";

/** One AGENTS.md-style context file: `path` is the label the model sees in
 * the system prompt (`<project_instructions path="…">`), `content` the raw
 * markdown. Structurally identical to pi's own agents-file entries. */
export type AgentsFileEntry = { path: string; content: string };

export type PiAgentEventListener = (event: AgentSessionEvent) => void;

export type PiAgentConfig = {
  /** Working directory the agent operates against. */
  cwd: string;
  /** Directory where pi keeps its agent-specific state (skills, AGENTS.md, etc). */
  agentDir: string;
  /** ModelRuntime supplier for credential lookup + provider streaming (pi's
   * canonical model/auth handle). A thunk resolved inside start() so runtime
   * construction failures reject the async start() path, and so all sessions
   * share the host's one cached runtime (agent/auth.ts::getModelRuntime). */
  modelRuntime: () => Promise<ModelRuntime>;
  /** Default model for new sessions, as a NEUTRAL (provider, modelId) pair —
   * resolved to pi-ai's Model inside start() (resolveModelSelection), so a
   * bad selection rejects the async start() path instead of throwing from
   * construction, and pi-ai's Model type stays inside pi/*. */
  model: ModelSelection;
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
  /**
   * Extra AGENTS.md-style context files APPENDED to pi's own discovered set
   * (agentDir + cwd-ancestor AGENTS.md) via the loader's supported
   * `agentsFilesOverride` hook — they join the system prompt's
   * `<project_context>` block like any discovered file. A thunk, invoked
   * during `resourceLoader.reload()` (i.e. at session start), so content is
   * read fresh each time a session is constructed. Used for the user's
   * vault/AGENTS.md instructions (chat + delegation sessions only).
   */
  extraAgentsFiles?: () => AgentsFileEntry[];
};

/** Lifecycle wrapper around pi-coding-agent's AgentSession. */
export class PiAgent {
  private session: AgentSession | null = null;
  /** The selection resolved at start() — set iff `session` is set. */
  private model: Model<Api> | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<PiAgentEventListener>();
  private status: PiAgentStatus = "starting";
  private error: string | null = null;

  constructor(private readonly config: PiAgentConfig) {}

  // ---- lifecycle -----------------------------------------------------------

  async start(): Promise<void> {
    if (this.session) return;

    // Resolve the neutral selection FIRST — a bad selection must reject
    // start() before any registry/loader side effects run.
    const model = resolveModelSelection(this.config.model);

    const modelRuntime = await this.config.modelRuntime();
    // Faux (dev-only) lives outside the runtime's builtin provider set —
    // register it before the session exists so the prompt gate passes.
    await prepareRuntimeForSelection(modelRuntime, this.config.model);

    const factories =
      typeof this.config.extensionFactories === "function"
        ? await this.config.extensionFactories()
        : this.config.extensionFactories;

    const extraAgentsFiles = this.config.extraAgentsFiles;
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.config.cwd,
      agentDir: this.config.agentDir,
      extensionFactories: factories,
      ...(extraAgentsFiles !== undefined
        ? {
            agentsFilesOverride: (base: { agentsFiles: AgentsFileEntry[] }) => ({
              agentsFiles: [...base.agentsFiles, ...extraAgentsFiles()],
            }),
          }
        : {}),
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: this.config.cwd,
      agentDir: this.config.agentDir,
      modelRuntime,
      resourceLoader,
      model,
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
    this.model = model;
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

    this.model = null;
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
    const model = this.ensureModel();
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
      this.error = toErrorMessage(err);
      console.error("[pi-driver] prompt error:", this.error);
      // Surface the rejection to subscribers — without this the user's
      // message renders as sent while the turn silently never happens (pi
      // only emits events for turns that actually ran). The synthetic
      // agent_end flips status to idle via handleEvent, so set the terminal
      // error status afterwards.
      for (const event of buildPromptFailureEvents(model, this.error)) {
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

  /** The live session's composed system prompt (base + tools + context files),
   * or null before start(). Read-only; serves the dev-only E2E assertion that
   * injected instructions actually reached the constructed session. */
  getSystemPrompt(): string | null {
    return this.session?.systemPrompt ?? null;
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

  private ensureModel(): Model<Api> {
    if (!this.model) {
      throw new Error("PiAgent not started — call start() first");
    }
    return this.model;
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
    { type: "agent_end", messages: [message], willRetry: false },
  ];
}
