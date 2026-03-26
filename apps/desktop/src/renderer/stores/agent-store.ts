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
// Store
// ---------------------------------------------------------------------------

type AgentStore = {
  messages: ChatMessage[];
  appState: AppState;

  init: () => () => void;
  /** Add a user message to the UI only (no command sent). Used by voice store. */
  addUserMessage: (text: string) => void;
  /** Add a steer message to the UI only. Used by voice store. */
  addSteerMessage: (text: string) => void;
  clearMessages: () => void;
};

let nextMsgId = 0;

export const useAgentStore = create<AgentStore>((set) => ({
  messages: [],
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
          break;
        }
      }
    });

    // Subscribe to app lifecycle state
    const unsubState = bridge.onAppState((appState: unknown) => {
      const parsed = AppStateSchema.safeParse(appState);
      if (!parsed.success) return;
      set({ appState: parsed.data });

      // Coordinated cleanup on logout
      if (parsed.data.phase === "logged_out") {
        set({ messages: [] });
        useVoiceStore.getState().reset();
      }
    });

    // Fetch initial state
    void bridge.getAppState().then((appState) => {
      set({ appState });
    });

    // Register callbacks with voice store to break circular dependency
    useVoiceStore.getState().setCallbacks({
      onUserMessage: (text: string) => {
        set((s) => ({
          messages: [...s.messages, { id: nextMsgId++, kind: "user", text }],
        }));
      },
      onSteerMessage: (text: string) => {
        set((s) => ({
          messages: [...s.messages, { id: nextMsgId++, kind: "steer", text }],
        }));
      },
    });

    return () => {
      unsubAgent();
      unsubState();
    };
  },

  addUserMessage: (text: string) => {
    set((s) => ({
      messages: [...s.messages, { id: nextMsgId++, kind: "user", text }],
    }));
  },

  addSteerMessage: (text: string) => {
    set((s) => ({
      messages: [...s.messages, { id: nextMsgId++, kind: "steer", text }],
    }));
  },

  clearMessages: () => {
    set({ messages: [] });
  },
}));
