import { create } from "zustand";

import type { AppAgentEvent } from "@/shared/agent-events";
import { AppStateSchema, type AppState } from "@/shared/app-state";
import type { ChatHistoryEntry } from "@/shared/ipc";
import type { ImageAttachment } from "@/shared/voice";
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
  | { id: number; kind: "user"; text: string; imageCount?: number }
  | { id: number; kind: "assistant"; text: string }
  | { id: number; kind: "steer"; text: string; imageCount?: number }
  | { id: number; kind: "tool"; execution: ToolExecution };

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type AgentStore = {
  messages: ChatMessage[];
  appState: AppState;
  /** Queued messages reported by pi (steer + followUp). Cleared on agent_end. */
  queuedFollowUp: string[];
  queuedSteering: string[];

  init: () => () => void;
  sendMessage: (text: string, images?: ImageAttachment[]) => void;
  steer: (text: string, images?: ImageAttachment[]) => void;
  followUp: (text: string, images?: ImageAttachment[]) => void;
  interrupt: () => void;
  newSession: () => Promise<void>;
  addUserMessage: (text: string) => void;
  addSteerMessage: (text: string) => void;
};

let nextMsgId = 0;

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Convert persisted session history entries into ChatMessages for the UI.
 */
function historyToChatMessages(history: ChatHistoryEntry[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const entry of history) {
    switch (entry.role) {
      case "user":
        messages.push({ id: nextMsgId++, kind: "user", text: entry.text });
        break;
      case "assistant":
        messages.push({ id: nextMsgId++, kind: "assistant", text: entry.text });
        break;
      case "tool":
        messages.push({
          id: nextMsgId++,
          kind: "tool",
          execution: {
            toolCallId: entry.toolCallId ?? "",
            toolName: entry.toolName ?? "",
            status: entry.isError ? "error" : "done",
            resultText: entry.text,
            isError: entry.isError ?? false,
          },
        });
        break;
    }
  }
  return messages;
}

export const useAgentStore = create<AgentStore>((set) => ({
  messages: [],
  appState: { phase: "logged_out" },
  queuedFollowUp: [],
  queuedSteering: [],

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
          set({ queuedFollowUp: [], queuedSteering: [] });
          break;

        case "queue_update":
          // Skip the set() if the queue is identical to what we already
          // hold. pi can re-emit queue_update for unrelated mutations, and
          // an unconditional set re-renders every Composer subscriber.
          set((s) =>
            sameStrings(s.queuedFollowUp, event.followUp) &&
            sameStrings(s.queuedSteering, event.steering)
              ? s
              : {
                  queuedFollowUp: event.followUp,
                  queuedSteering: event.steering,
                },
          );
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
          {
            const voice = useVoiceStore.getState();
            if (voice.sessionState === "connected") voice.speakText(delta);
          }
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
          {
            const voice = useVoiceStore.getState();
            if (voice.sessionState === "connected") voice.flushSpeech();
          }
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

      if (parsed.data.phase === "logged_out") {
        set({ messages: [], queuedFollowUp: [], queuedSteering: [] });
        useVoiceStore.getState().reset();
      }
    });

    // Fetch initial state, then load persisted session history once we know
    // the real app phase (appState defaults to logged_out before this resolves).
    void (async () => {
      try {
        const appState = await bridge.getAppState();
        set({ appState });

        if (appState.phase === "logged_out") return;

        const history = await bridge.getAgentHistory();
        if (history.length > 0) {
          set((s) =>
            s.messages.length === 0 && s.appState.phase !== "logged_out"
              ? { messages: historyToChatMessages(history) }
              : s,
          );
        }
      } catch (err) {
        console.warn("[agent-store] failed to load history:", err);
      }
    })();

    return () => {
      unsubAgent();
      unsubState();
    };
  },

  // --- Agent commands (IPC) -------------------------------------------------

  sendMessage: (text: string, images?: ImageAttachment[]) => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.sendAgentCommand({ type: "user_message", text, images });
    set((s) => ({
      messages: [
        ...s.messages,
        { id: nextMsgId++, kind: "user", text, imageCount: images?.length },
      ],
    }));
  },

  steer: (text: string, images?: ImageAttachment[]) => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.sendAgentCommand({ type: "steer", text, images });
    set((s) => ({
      messages: [
        ...s.messages,
        { id: nextMsgId++, kind: "steer", text, imageCount: images?.length },
      ],
    }));
  },

  followUp: (text: string, images?: ImageAttachment[]) => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.sendAgentCommand({ type: "follow_up", text, images });
    set((s) => ({
      messages: [
        ...s.messages,
        { id: nextMsgId++, kind: "user", text, imageCount: images?.length },
      ],
    }));
  },

  interrupt: () => {
    void getBridge()?.sendAgentCommand({ type: "interrupt" });
  },

  newSession: async () => {
    set({ messages: [], queuedFollowUp: [], queuedSteering: [] });
    await getBridge()?.transition({ type: "NEW_SESSION" });
  },

  // --- UI-only message additions (used by voice transcripts) ----------------

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
}));
