import { create } from "zustand";

import type { AppAgentEvent } from "@/shared/agent-events";
import { AppStateSchema, type AppState } from "@/shared/app-state";
import { getBridge } from "@/renderer/lib/bridge";
import { useVoiceStore } from "@/renderer/stores/voice-store";

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
// localStorage persistence
// ---------------------------------------------------------------------------

const MESSAGES_STORAGE_KEY = "inteligir:chat-messages";

function loadPersistedMessages(): ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(MESSAGES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistMessages(messages: ChatMessage[]): void {
  try {
    window.localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(messages));
  } catch { /* quota exceeded — ignore */ }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type AgentStore = {
  messages: ChatMessage[];
  appState: AppState;

  init: () => () => void;
  sendMessage: (text: string) => void;
  steer: (text: string) => void;
  interrupt: () => void;
  addUserMessage: (text: string) => void;
  addSteerMessage: (text: string) => void;
};

let nextMsgId = 0;

export const useAgentStore = create<AgentStore>((set, get) => {
  const initialMessages = loadPersistedMessages();
  nextMsgId = initialMessages.reduce((max, m) => Math.max(max, m.id + 1), 0);

  /** Persist current messages to localStorage (call after stable state changes). */
  const save = () => persistMessages(get().messages);

  return {
  messages: initialMessages,
  appState: { phase: "logged_out" },

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};

    let streamingMsgId: number | null = null;
    const toolMsgIds = new Map<string, number>();

    // Subscribe to typed agent session events (chat streaming)
    const unsubAgent = bridge.onAgentEvent((event: AppAgentEvent) => {
      switch (event.type) {
        case "agent_end":
          streamingMsgId = null;
          toolMsgIds.clear();
          save();
          break;

        case "sidecar_error":
          streamingMsgId = null;
          toolMsgIds.clear();
          useVoiceStore.getState().handleSidecarError(event.message);
          break;

        case "message_start": {
          if (event.role !== "assistant") break;
          const id = nextMsgId++;
          streamingMsgId = id;
          set((s) => ({
            messages: [...s.messages, { id, kind: "assistant", text: "" }],
          }));
          break;
        }

        case "message_update": {
          if (streamingMsgId === null) break;
          const sid = streamingMsgId;
          const delta = event.delta;
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
          if (streamingMsgId === null || event.role !== "assistant") break;
          const sid = streamingMsgId;
          const { text } = event;
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === sid && m.kind === "assistant" ? { ...m, text } : m,
            ),
          }));
          streamingMsgId = null;
          save();
          break;
        }

        case "tool_execution_start": {
          const id = nextMsgId++;
          toolMsgIds.set(event.toolCallId, id);
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id,
                kind: "tool",
                execution: {
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
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
          const msgId = toolMsgIds.get(event.toolCallId);
          if (msgId === undefined) break;
          toolMsgIds.delete(event.toolCallId);
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === msgId && m.kind === "tool"
                ? {
                    ...m,
                    execution: {
                      ...m.execution,
                      status: event.isError ? "error" : "done",
                      resultText: event.resultText,
                      isError: event.isError,
                    },
                  }
                : m,
            ),
          }));
          save();
          break;
        }
      }
    });

    // Subscribe to app lifecycle state
    const unsubState = bridge.onAppState((appState: unknown) => {
      const parsed = AppStateSchema.safeParse(appState);
      if (!parsed.success) return;
      set({ appState: parsed.data });

      if (parsed.data.phase === "logged_out") {
        set({ messages: [] });
        persistMessages([]);
        useVoiceStore.getState().reset();
      }
    });

    // Fetch initial state
    void bridge.getAppState().then((appState) => {
      set({ appState });
    });

    return () => {
      unsubAgent();
      unsubState();
    };
  },

  // --- Agent commands (IPC) -------------------------------------------------

  sendMessage: (text: string) => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.sendAgentCommand({ type: "user_message", text });
    set((s) => {
      const messages = [...s.messages, { id: nextMsgId++, kind: "user" as const, text }];
      persistMessages(messages);
      return { messages };
    });
  },

  steer: (text: string) => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.sendAgentCommand({ type: "steer", text });
    set((s) => {
      const messages = [...s.messages, { id: nextMsgId++, kind: "steer" as const, text }];
      persistMessages(messages);
      return { messages };
    });
  },

  interrupt: () => {
    void getBridge()?.sendAgentCommand({ type: "interrupt" });
  },

  // --- UI-only message additions (used by voice transcripts) ----------------

  addUserMessage: (text: string) => {
    set((s) => {
      const messages = [...s.messages, { id: nextMsgId++, kind: "user" as const, text }];
      persistMessages(messages);
      return { messages };
    });
  },

  addSteerMessage: (text: string) => {
    set((s) => {
      const messages = [...s.messages, { id: nextMsgId++, kind: "steer" as const, text }];
      persistMessages(messages);
      return { messages };
    });
  },
}});
