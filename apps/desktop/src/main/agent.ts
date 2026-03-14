import { Agent as PiAgent } from "@mariozechner/pi-agent-core";
import type { AgentEvent as PiAgentEvent } from "@mariozechner/pi-agent-core";
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

import { getSettings, resolveAccessToken } from "./settings";
import { appendEntry, readEntries, clearConversation } from "./conversation-store";
import { extractText, extractRole, toErrorMessage } from "../shared/ipc";
import { createBashTool } from "./tools/bash";
import { createReadTool } from "./tools/read";
import { createWriteTool } from "./tools/write";
import { createEditTool } from "./tools/edit";
import { createGrepTool } from "./tools/grep";
import { createFindTool } from "./tools/find";
import { createLsTool } from "./tools/ls";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPT = `You are Inteligir, an AI Chief of Staff. You help the user manage tasks, coordinate workflows, and stay on top of their priorities. You have access to tools for reading/writing files, editing code, and running shell commands. Be concise and action-oriented.`;

const DEFAULT_MODEL: Model<Api> = getModel("openai-codex", "gpt-5.4" as never);

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

  // ---- lifecycle -----------------------------------------------------------

  async start(): Promise<void> {
    if (this.piAgent) return;

    const settings = getSettings();
    const systemPrompt = settings.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const cwd = process.cwd();
    const tools = [
      createBashTool(cwd),
      createReadTool(cwd),
      createWriteTool(cwd),
      createEditTool(cwd),
      createGrepTool(cwd),
      createFindTool(cwd),
      createLsTool(cwd),
    ];

    const agent = new PiAgent({
      initialState: {
        systemPrompt,
        model: DEFAULT_MODEL,
        tools,
        thinkingLevel: "off",
      },
      getApiKey: () => resolveAccessToken(),
    });

    this.unsubscribe = agent.subscribe((event: PiAgentEvent) => {
      this.handleEvent(event);
    });

    this.piAgent = agent;
    this.status = "idle";
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;

    if (this.piAgent) {
      this.piAgent.abort();
      this.piAgent = null;
    }

    this.status = "starting";
    this.error = null;
  }

  // ---- public API ----------------------------------------------------------

  async sendMessage(message: string): Promise<SendMessageResult> {
    const agent = this.ensureAgent();
    this.status = "busy";

    appendEntry({ kind: "user", text: message, timestamp: Date.now() });

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
        break;
      case "agent_end":
        this.status = "idle";
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
}
