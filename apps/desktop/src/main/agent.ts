import fs from "node:fs";
import path from "node:path";

import { Agent as PiAgent } from "@mariozechner/pi-agent-core";
import type { AgentEvent as PiAgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
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
import { saveSession, loadSession, clearSession } from "./session-store";
import { getTasks } from "./task-store";
import { extractText, extractRole, toErrorMessage } from "../shared/ipc";
import { createBashTool } from "./tools/bash";
import { createReadTool } from "./tools/read";
import { createWriteTool } from "./tools/write";
import { createEditTool } from "./tools/edit";
import { createGrepTool } from "./tools/grep";
import { createFindTool } from "./tools/find";
import { createLsTool } from "./tools/ls";
import { createManageTasksTool } from "./tools/tasks";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const ARCHIVES_DIR = inteligirPath("archives");
const CLAUDE_MD_PATH = inteligirPath("CLAUDE.md");

const DEFAULT_SYSTEM_PROMPT = `You are Samantha, an intuitive AI assistant. You live on the user's desktop, learn how they think, and adapt to how they work.

## Capabilities
- **File operations**: read, write, edit files in the working directory
- **Shell**: execute bash commands
- **Search**: grep for content, find files by pattern, list directories
- **Task management**: create, list, toggle, and delete scheduled tasks via the manage_tasks tool

## Guidelines
- Be concise and action-oriented
- When creating tasks, confirm the schedule with the user before committing
- For destructive operations (deleting files, dropping data), confirm first
- If a tool call fails, diagnose and try an alternative approach`;

const DEFAULT_MODEL: Model<Api> = getModel("openai-codex", "gpt-5.4" as never);

export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Rough token estimate: ~4 chars per token */
const CHARS_PER_TOKEN = 4;
const MAX_CONTEXT_TOKENS = 100_000;
const KEEP_RECENT_RATIO = 0.6;

// ---------------------------------------------------------------------------
// Agent — single persistent session
// ---------------------------------------------------------------------------

type EventListener = (event: PiAgentEvent) => void;

export class Agent {
  private piAgent: PiAgent | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<EventListener>();
  private status: SessionStatus = "starting";
  private error: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- lifecycle -----------------------------------------------------------

  async start(): Promise<void> {
    if (this.piAgent) return;

    const systemPrompt = buildSystemPrompt();
    const cwd = process.cwd();
    const tools = [
      createBashTool(cwd),
      createReadTool(cwd),
      createWriteTool(cwd),
      createEditTool(cwd),
      createGrepTool(cwd),
      createFindTool(cwd),
      createLsTool(cwd),
      createManageTasksTool(),
    ];

    const agent = new PiAgent({
      initialState: {
        systemPrompt,
        model: DEFAULT_MODEL,
        tools,
        thinkingLevel: "off",
      },
      sessionId: "inteligir",
      followUpMode: "one-at-a-time",
      transformContext: transformContext,
      getApiKey: () => resolveAccessToken(),
    });

    this.unsubscribe = agent.subscribe((event: PiAgentEvent) => {
      this.handleEvent(event);
    });

    this.piAgent = agent;

    // Session resume: restore LLM context from previous run
    const saved = loadSession();
    if (saved) {
      try {
        agent.replaceMessages(saved as AgentMessage[]);
        console.log("[agent] restored session with", saved.length, "messages");
      } catch (err) {
        console.warn("[agent] session restore failed, starting fresh:", err);
      }
    }

    // Crash recovery: check if last conversation entry is an unanswered user message
    this.checkCrashRecovery();

    this.status = "idle";
  }

  async stop(): Promise<void> {
    this.clearIdleTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;

    if (this.piAgent) {
      this.piAgent.abort();
      this.piAgent = null;
    }

    this.status = "starting";
    this.error = null;
  }

  /**
   * Wait for the agent to finish its current turn (up to timeoutMs).
   * Returns true if idle, false if timed out.
   */
  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!this.piAgent || this.status !== "busy") return true;
    return Promise.race([
      this.piAgent.waitForIdle().then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
  }

  // ---- public API ----------------------------------------------------------

  async sendMessage(message: string): Promise<SendMessageResult> {
    const agent = this.ensureAgent();

    appendEntry({ kind: "user", text: message, timestamp: Date.now() });

    if (this.status === "busy") {
      // Queue for delivery after current turn
      agent.followUp({
        role: "user",
        content: [{ type: "text", text: message }],
        timestamp: Date.now(),
      });
      return { accepted: true };
    }

    this.status = "busy";

    void agent.prompt(message).catch((err: unknown) => {
      this.status = "error";
      this.error = toErrorMessage(err);
      console.error("[agent] prompt error:", this.error);
    });

    return { accepted: true };
  }

  async steer(message: string): Promise<SteerResult> {
    const agent = this.ensureAgent();

    appendEntry({ kind: "steer", text: message, timestamp: Date.now() });

    agent.steer({
      role: "user",
      content: [{ type: "text", text: message }],
      timestamp: Date.now(),
    });

    return { accepted: true };
  }

  async interrupt(): Promise<InterruptResult> {
    if (!this.piAgent) return { interrupted: false };
    this.piAgent.abort();
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
    clearSession();
    if (this.piAgent) {
      this.piAgent.clearMessages();
    }
  }

  // ---- subscriptions -------------------------------------------------------

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ---- internals -----------------------------------------------------------

  private handleEvent(event: PiAgentEvent): void {
    switch (event.type) {
      case "agent_start":
        this.status = "busy";
        this.startIdleTimer();
        break;
      case "agent_end":
        this.status = "idle";
        this.clearIdleTimer();
        // Persist session for resume on next launch
        saveSession(event.messages);
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

  private broadcast(event: PiAgentEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* */ }
    }
  }

  private ensureAgent(): PiAgent {
    if (!this.piAgent) throw new Error("Agent not started — call start() first");
    return this.piAgent;
  }

  // ---- idle timeout --------------------------------------------------------

  private startIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.status === "busy" && this.piAgent) {
        console.warn("[agent] idle timeout reached, aborting");
        this.piAgent.abort();
        this.status = "error";
        this.error = "Agent timed out after 5 minutes";
        // Broadcast synthetic agent_end so renderer updates
        this.broadcast({ type: "agent_end", messages: this.piAgent.state.messages });
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

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  const settings = getSettings();
  const parts: string[] = [];

  // 1. Base prompt (settings override or default)
  parts.push(settings.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);

  // 2. User's persistent instructions from ~/.inteligir/CLAUDE.md
  try {
    const claudeMd = fs.readFileSync(CLAUDE_MD_PATH, "utf8").trim();
    if (claudeMd) {
      parts.push(`\n## User Instructions\n${claudeMd}`);
    }
  } catch {
    // No CLAUDE.md — fine
  }

  // 3. Current date
  parts.push(`\nCurrent date: ${new Date().toISOString().slice(0, 10)}`);

  // 4. Active tasks summary
  const tasks = getTasks().filter((t) => t.enabled);
  if (tasks.length > 0) {
    const summary = tasks
      .map((t) => `- ${t.label}: ${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? "..." : ""} (${t.schedule.type})`)
      .join("\n");
    parts.push(`\n## Active Scheduled Tasks\n${summary}`);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Context window management
// ---------------------------------------------------------------------------

function estimateTokens(messages: AgentMessage[]): number {
  const json = JSON.stringify(messages);
  return Math.ceil(json.length / CHARS_PER_TOKEN);
}

async function transformContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
  const tokens = estimateTokens(messages);
  if (tokens <= MAX_CONTEXT_TOKENS) return messages;

  const keepCount = Math.ceil(messages.length * KEEP_RECENT_RATIO);
  const archiveMessages = messages.slice(0, messages.length - keepCount);
  const keptMessages = messages.slice(messages.length - keepCount);

  // Archive pruned messages
  try {
    fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archivePath = path.join(ARCHIVES_DIR, `${timestamp}.json`);
    fs.writeFileSync(archivePath, JSON.stringify(archiveMessages, null, 2), "utf8");
    console.log("[agent] archived", archiveMessages.length, "messages to", archivePath);
  } catch (err) {
    console.warn("[agent] failed to archive context:", err);
  }

  // Prepend note about archived context
  const note: AgentMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: `[System note: ${archiveMessages.length} earlier messages were archived to stay within context limits. The conversation continues from the most recent messages below.]`,
      },
    ],
    timestamp: Date.now(),
  };

  return [note, ...keptMessages];
}
