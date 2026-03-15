import {
  AuthStorage,
  createAgentSession,
  SessionManager,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import type { Api, Model } from "@mariozechner/pi-ai";

import type {
  GetStateResult,
  InterruptResult,
  SendMessageResult,
  SessionStatus,
  SteerResult,
} from "../shared/agent";
import type { ConversationEntry } from "../shared/conversation";

import { inteligirPath } from "./json-store";
import { getSettings, resolveAccessToken } from "./settings";
import { appendEntry, readEntries, clearConversation } from "./conversation-store";
import { getTasks } from "./task-store";
import { extractText, extractRole, toErrorMessage } from "../shared/ipc";
import { createManageTasksTool } from "./tools/tasks";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const AGENT_DIR = inteligirPath("agent");

const DEFAULT_SYSTEM_PROMPT = `You are Inteligir, an AI Chief of Staff. You help the user manage tasks, coordinate workflows, and stay on top of their priorities.

## Guidelines
- Be concise and action-oriented
- When creating tasks, confirm the schedule with the user before committing
- For destructive operations (deleting files, dropping data), confirm first
- If a tool call fails, diagnose and try an alternative approach`;

const DEFAULT_MODEL: Model<Api> = getModel("openai-codex", "gpt-5.4" as never);

export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Agent — wraps pi-coding-agent's AgentSession
// ---------------------------------------------------------------------------

type EventListener = (event: AgentSessionEvent) => void;

export class Agent {
  private session: AgentSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<EventListener>();
  private status: SessionStatus = "starting";
  private error: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- lifecycle -----------------------------------------------------------

  async start(): Promise<void> {
    if (this.session) return;

    const settings = getSettings();
    const authStorage = AuthStorage.create();
    const modelRegistry = new ModelRegistry(authStorage);

    const { session } = await createAgentSession({
      cwd: process.cwd(),
      agentDir: AGENT_DIR,
      authStorage,
      modelRegistry,
      model: DEFAULT_MODEL,
      thinkingLevel: "off",
      tools: [createManageTasksTool()],
      sessionManager: SessionManager.inMemory(),
    });

    // Override system prompt with our custom one
    const parts = [settings.systemPrompt ?? DEFAULT_SYSTEM_PROMPT];

    // Active tasks summary
    const tasks = getTasks().filter((t) => t.enabled);
    if (tasks.length > 0) {
      const summary = tasks
        .map((t) => `- ${t.label}: ${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? "..." : ""} (${t.schedule.type})`)
        .join("\n");
      parts.push(`\n## Active Scheduled Tasks\n${summary}`);
    }

    // The coding agent's system prompt already includes tool descriptions,
    // skill instructions, and AGENTS.md content. We prepend our identity.
    const basePrompt = session.state().systemPrompt;
    session.state().systemPrompt = parts.join("\n") + "\n\n" + basePrompt;

    this.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      this.handleEvent(event);
    });

    this.session = session;

    // Crash recovery: check if last conversation entry is an unanswered user message
    this.checkCrashRecovery();

    this.status = "idle";
  }

  async stop(): Promise<void> {
    this.clearIdleTimer();
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
   * Wait for the agent to finish its current turn (up to timeoutMs).
   * Returns true if idle, false if timed out.
   */
  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!this.session || this.status !== "busy") return true;
    return Promise.race([
      new Promise<boolean>((resolve) => {
        const unsub = this.session!.subscribe((event) => {
          if (event.type === "agent_end") {
            unsub();
            resolve(true);
          }
        });
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
  }

  // ---- public API ----------------------------------------------------------

  async sendMessage(message: string): Promise<SendMessageResult> {
    const session = this.ensureSession();

    appendEntry({ kind: "user", text: message, timestamp: Date.now() });

    if (this.status === "busy") {
      await session.followUp(message);
      return { accepted: true };
    }

    this.status = "busy";

    void session.prompt(message).catch((err: unknown) => {
      this.status = "error";
      this.error = toErrorMessage(err);
      console.error("[agent] prompt error:", this.error);
    });

    return { accepted: true };
  }

  async steer(message: string): Promise<SteerResult> {
    const session = this.ensureSession();

    appendEntry({ kind: "steer", text: message, timestamp: Date.now() });
    await session.steer(message);

    return { accepted: true };
  }

  async interrupt(): Promise<InterruptResult> {
    if (!this.session) return { interrupted: false };
    await this.session.abort();
    return { interrupted: true };
  }

  getState(): GetStateResult {
    return { status: this.status, error: this.error };
  }

  getMessages(): ConversationEntry[] {
    return readEntries();
  }

  clear(): void {
    clearConversation();
    if (this.session) {
      void this.session.newSession();
    }
  }

  // ---- subscriptions -------------------------------------------------------

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ---- internals -----------------------------------------------------------

  private handleEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case "agent_start":
        this.status = "busy";
        this.startIdleTimer();
        break;
      case "agent_end":
        this.status = "idle";
        this.clearIdleTimer();
        break;
      case "message_end": {
        const text = extractText(event.message);
        const role = extractRole(event.message);
        if (role === "assistant" && text) {
          appendEntry({ kind: "assistant", text, timestamp: Date.now() });
        }
        break;
      }
      case "tool_execution_end":
        appendEntry({
          kind: "tool",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          resultText: extractText(event.result),
          timestamp: Date.now(),
        });
        break;
    }

    this.broadcast(event);
  }

  private broadcast(event: AgentSessionEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* */ }
    }
  }

  private ensureSession(): AgentSession {
    if (!this.session) throw new Error("Agent not started — call start() first");
    return this.session;
  }

  // ---- idle timeout --------------------------------------------------------

  private startIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.status === "busy" && this.session) {
        console.warn("[agent] idle timeout reached, aborting");
        void this.session.abort();
        this.status = "error";
        this.error = "Agent timed out after 5 minutes";
        this.broadcast({ type: "agent_end", messages: this.session.messages() } as AgentSessionEvent);
      }
    }, IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // ---- crash recovery ------------------------------------------------------

  private checkCrashRecovery(): void {
    const entries = readEntries();
    if (entries.length === 0) return;

    const last = entries[entries.length - 1];
    if (last.kind === "user") {
      appendEntry({
        kind: "assistant",
        text: "[Previous turn was interrupted — you may need to resend your last message]",
        timestamp: Date.now(),
      });
    }
  }
}
