import { create } from "zustand";

import type { SessionStatus } from "@/shared/agent";
import { extractText, isRecord } from "@/shared/ipc";
import { getBridge } from "@/renderer/lib/bridge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolExecution = {
  toolCallId: string;
  toolName: string;
  status: "running" | "done" | "error";
  resultText: string;
  isError: boolean;
};

export type ChatMessage =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string }
  | { id: number; kind: "steer"; text: string }
  | { id: number; kind: "tool"; execution: ToolExecution };

// ---------------------------------------------------------------------------
// Narrow helpers for raw pi-agent-core events
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function bool(v: unknown): boolean {
  return typeof v === "boolean" ? v : false;
}

function eventType(event: unknown): string {
  if (typeof event === "object" && event !== null && "type" in event) {
    return str((event as Record<string, unknown>).type);
  }
  return "";
}

function messageRole(event: unknown): string {
  if (!isRecord(event)) return "";
  const message = event.message;
  if (isRecord(message)) return str(message.role);
  return "";
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type AgentStore = {
  messages: ChatMessage[];
  setupChecked: boolean;
  needsLogin: boolean;
  needsOnboarding: boolean;
  sessionStatus: SessionStatus;

  init: () => () => void;
  sendMessage: (text: string) => void;
  steer: (text: string) => void;
  interrupt: () => void;
  clearMessages: () => void;
  fetchState: () => void;
  checkSetup: () => void;
  refreshStatus: () => void;
};

let nextMsgId = 0;

export const useAgentStore = create<AgentStore>((set, get) => ({
  messages: [],
  setupChecked: false,
  needsLogin: false,
  needsOnboarding: false,
  sessionStatus: "starting",

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};

    let streamingMsgId: number | null = null;
    const toolMsgIds = new Map<string, number>();

    const unsubscribe = bridge.onAgentEvent((event: unknown) => {
      const type = eventType(event);

      switch (type) {
        case "agent_start":
          set({ sessionStatus: "busy" });
          break;

        case "agent_end":
          set({ sessionStatus: "idle" });
          streamingMsgId = null;
          toolMsgIds.clear();
          break;

        case "message_start": {
          if (messageRole(event) !== "assistant") break;
          const id = nextMsgId++;
          streamingMsgId = id;
          set((s) => ({
            messages: [...s.messages, { id, kind: "assistant", text: "" }],
          }));
          break;
        }

        case "message_update": {
          if (streamingMsgId === null || !isRecord(event)) break;
          const ame = event.assistantMessageEvent;
          if (!isRecord(ame) || str(ame.type) !== "text_delta") break;
          const delta = str(ame.delta);
          if (!delta) break;
          const sid = streamingMsgId;
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === sid && m.kind === "assistant"
                ? { ...m, text: m.text + delta }
                : m,
            ),
          }));
          break;
        }

        case "message_end": {
          if (streamingMsgId === null || messageRole(event) !== "assistant" || !isRecord(event)) break;
          const text = extractText(event.message);
          const sid = streamingMsgId;
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === sid && m.kind === "assistant" ? { ...m, text } : m,
            ),
          }));
          streamingMsgId = null;
          break;
        }

        case "tool_execution_start": {
          if (!isRecord(event)) break;
          const id = nextMsgId++;
          const toolCallId = str(event.toolCallId);
          toolMsgIds.set(toolCallId, id);
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id,
                kind: "tool",
                execution: {
                  toolCallId,
                  toolName: str(event.toolName),
                  status: "running",
                  resultText: "",
                  isError: false,
                },
              },
            ],
          }));
          break;
        }

        case "tool_execution_end": {
          if (!isRecord(event)) break;
          const toolCallId = str(event.toolCallId);
          const msgId = toolMsgIds.get(toolCallId);
          if (msgId === undefined) break;
          toolMsgIds.delete(toolCallId);
          const isError = bool(event.isError);
          const resultText = extractText(event.result);
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === msgId && m.kind === "tool"
                ? {
                    ...m,
                    execution: {
                      ...m.execution,
                      status: isError ? "error" : "done",
                      resultText,
                      isError,
                    },
                  }
                : m,
            ),
          }));
          break;
        }
      }
    });

    get().refreshStatus();

    return () => { unsubscribe(); };
  },

  sendMessage: (text: string) => {
    const bridge = getBridge();
    if (!bridge) return;
    set((s) => ({
      messages: [...s.messages, { id: nextMsgId++, kind: "user", text }],
    }));
    void bridge.sendMessage(text);
  },

  steer: (text: string) => {
    const bridge = getBridge();
    if (!bridge || get().sessionStatus !== "busy") return;
    set((s) => ({
      messages: [...s.messages, { id: nextMsgId++, kind: "steer", text }],
    }));
    void bridge.steer(text);
  },

  interrupt: () => {
    const bridge = getBridge();
    if (!bridge || get().sessionStatus !== "busy") return;
    void bridge.interrupt();
  },

  clearMessages: () => {
    const bridge = getBridge();
    set({ messages: [] });
    if (bridge) void bridge.clear();
  },

  fetchState: () => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge
      .getAgentState()
      .then((result) => set({ sessionStatus: result.status }))
      .catch(() => {});
  },

  checkSetup: () => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge
      .getSettings()
      .then((settings) => {
        const needsLogin = !settings.loggedIn;
        const needsOnboarding = settings.loggedIn && !settings.setupComplete;
        const s = get();
        if (!s.setupChecked || s.needsLogin !== needsLogin || s.needsOnboarding !== needsOnboarding) {
          set({ setupChecked: true, needsLogin, needsOnboarding });
        }
      })
      .catch(() => set({ setupChecked: true, needsLogin: true, needsOnboarding: false }));
  },

  refreshStatus: () => {
    get().checkSetup();
    get().fetchState();
  },
}));
