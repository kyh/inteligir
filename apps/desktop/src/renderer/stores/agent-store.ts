import type { DynamicToolUIPart, TextUIPart, UIMessage } from "ai";
import { create } from "zustand";

import type { AppAgentEvent } from "@/shared/agent-events";
import { AppStateSchema, type AppState } from "@/shared/app-state";
import type { DesktopBridge } from "@/shared/ipc";
import type { ImageAttachment } from "@/shared/voice";
import { getBridge } from "@/renderer/lib/bridge";
import { useVoiceStore } from "@/renderer/stores/voice-store";

// ---------------------------------------------------------------------------
// Types
//
// We model the chat as a flat list of AI SDK UIMessage objects. Each message
// carries a single content part: user/assistant turns hold a TextUIPart;
// tool executions hold a DynamicToolUIPart whose state mirrors the agent's
// run-time status. The "steer" UX concept (a steering nudge sent mid-turn)
// rides on a user-role message via metadata.steer so the renderer can style
// it differently without inventing a new role outside the SDK shape.
// ---------------------------------------------------------------------------

export type ChatMessageMetadata = {
  steer?: boolean;
  imageCount?: number;
};

export type ChatMessage = UIMessage<ChatMessageMetadata>;

export type SendIntent = "steer";
export type SendOptions = { intent?: SendIntent };

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type SetFn = (
  partial:
    | Partial<AgentStore>
    | ((state: AgentStore) => Partial<AgentStore> | AgentStore),
) => void;
type GetFn = () => AgentStore;

type AgentStore = {
  messages: ChatMessage[];
  appState: AppState;
  /** Queued messages reported by pi (steer + followUp). Cleared on agent_end. */
  queuedFollowUp: string[];
  queuedSteering: string[];

  init: () => () => void;
  /**
   * Dispatch a user submission. The store reads the live agent state at call
   * time and routes to the right IPC command (`user_message` / `follow_up` /
   * `steer`), so callers don't need to track busy themselves.
   */
  send: (text: string, images?: ImageAttachment[], options?: SendOptions) => void;
  interrupt: () => void;
  newSession: () => Promise<void>;
  addUserMessage: (text: string) => void;
  addSteerMessage: (text: string) => void;
};

let nextMsgId = 0;
const makeId = () => `m_${nextMsgId++}`;

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isBusy(state: AppState): boolean {
  return state.phase === "ready" && state.agent === "busy";
}

// ---------------------------------------------------------------------------
// Helpers for constructing parts
// ---------------------------------------------------------------------------

function textPart(text: string, state?: TextUIPart["state"]): TextUIPart {
  return state ? { type: "text", text, state } : { type: "text", text };
}

function toolPartRunning(toolCallId: string, toolName: string): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolCallId,
    toolName,
    state: "input-available",
    input: undefined as unknown,
  };
}

function toolPartDone(
  toolCallId: string,
  toolName: string,
  resultText: string,
): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolCallId,
    toolName,
    state: "output-available",
    input: undefined as unknown,
    output: resultText,
  };
}

function toolPartError(
  toolCallId: string,
  toolName: string,
  errorText: string,
): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolCallId,
    toolName,
    state: "output-error",
    input: undefined as unknown,
    errorText,
  };
}

function userMessage(text: string, meta?: ChatMessageMetadata): ChatMessage {
  return {
    id: makeId(),
    role: "user",
    parts: [textPart(text)],
    ...(meta ? { metadata: meta } : {}),
  };
}

function assistantTextMessage(text: string, streaming = false): ChatMessage {
  return {
    id: makeId(),
    role: "assistant",
    parts: [textPart(text, streaming ? "streaming" : undefined)],
  };
}

function assistantToolMessage(part: DynamicToolUIPart): ChatMessage {
  return {
    id: makeId(),
    role: "assistant",
    parts: [part],
  };
}

// ---------------------------------------------------------------------------
// Persisted-history → UIMessage[] conversion
// ---------------------------------------------------------------------------

function historyToChatMessages(
  history: Awaited<ReturnType<DesktopBridge["getAgentHistory"]>>,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const entry of history) {
    switch (entry.role) {
      case "user":
        messages.push(userMessage(entry.text));
        break;
      case "assistant":
        messages.push(assistantTextMessage(entry.text));
        break;
      case "tool": {
        const toolName = entry.toolName ?? "";
        const toolCallId = entry.toolCallId ?? "";
        const part = entry.isError
          ? toolPartError(toolCallId, toolName, entry.text)
          : toolPartDone(toolCallId, toolName, entry.text);
        messages.push(assistantToolMessage(part));
        break;
      }
    }
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Mutators that preserve discriminated-union narrowing for parts
// ---------------------------------------------------------------------------

function mapMessageWithTextPart(
  msg: ChatMessage,
  mutate: (part: TextUIPart) => TextUIPart,
): ChatMessage {
  const first = msg.parts[0];
  if (!first || first.type !== "text") return msg;
  const next = mutate(first);
  if (next === first) return msg;
  return { ...msg, parts: [next, ...msg.parts.slice(1)] };
}

function replaceToolPart(msg: ChatMessage, next: DynamicToolUIPart): ChatMessage {
  const first = msg.parts[0];
  if (!first || first.type !== "dynamic-tool") return msg;
  if (next === first) return msg;
  return { ...msg, parts: [next, ...msg.parts.slice(1)] };
}

// ---------------------------------------------------------------------------
// Subscription handlers (split out of init() for readability)
// ---------------------------------------------------------------------------

function subscribeAgentEvents(bridge: DesktopBridge, set: SetFn): () => void {
  let streamingMsgId: string | null = null;
  const toolMsgIds = new Map<string, string>();

  return bridge.onAgentEvent((event: AppAgentEvent) => {
    switch (event.type) {
      case "agent_end":
        streamingMsgId = null;
        toolMsgIds.clear();
        set({ queuedFollowUp: [], queuedSteering: [] });
        break;

      case "queue_update":
        // Skip the set() if the queue is identical to what we already hold.
        // pi can re-emit queue_update for unrelated mutations; an unconditional
        // set re-renders every Composer subscriber.
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
        const msg = assistantTextMessage("", true);
        streamingMsgId = msg.id;
        set((s) => ({ messages: [...s.messages, msg] }));
        break;
      }

      case "message_update": {
        if (streamingMsgId === null) break;
        const sid = streamingMsgId;
        const delta = event.delta;
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === sid
              ? mapMessageWithTextPart(m, (part) => ({
                  ...part,
                  text: part.text + delta,
                }))
              : m,
          ),
        }));
        const voice = useVoiceStore.getState();
        if (voice.sessionState === "connected") voice.speakText(delta);
        break;
      }

      case "message_end": {
        if (streamingMsgId === null || event.role !== "assistant") break;
        const sid = streamingMsgId;
        const { text } = event;
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === sid ? mapMessageWithTextPart(m, () => textPart(text)) : m,
          ),
        }));
        streamingMsgId = null;
        const voice = useVoiceStore.getState();
        if (voice.sessionState === "connected") voice.flushSpeech();
        break;
      }

      case "tool_execution_start": {
        const msg = assistantToolMessage(toolPartRunning(event.toolCallId, event.toolName));
        toolMsgIds.set(event.toolCallId, msg.id);
        set((s) => ({ messages: [...s.messages, msg] }));
        break;
      }

      case "tool_execution_end": {
        const msgId = toolMsgIds.get(event.toolCallId);
        if (msgId === undefined) break;
        toolMsgIds.delete(event.toolCallId);
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== msgId) return m;
            const first = m.parts[0];
            if (!first || first.type !== "dynamic-tool") return m;
            const next = event.isError
              ? toolPartError(first.toolCallId, first.toolName, event.resultText)
              : toolPartDone(first.toolCallId, first.toolName, event.resultText);
            return replaceToolPart(m, next);
          }),
        }));
        break;
      }
    }
  });
}

function subscribeAppState(bridge: DesktopBridge, set: SetFn): () => void {
  return bridge.onAppState((appState: unknown) => {
    const parsed = AppStateSchema.safeParse(appState);
    if (!parsed.success) return;
    set({ appState: parsed.data });

    if (parsed.data.phase === "logged_out") {
      set({ messages: [], queuedFollowUp: [], queuedSteering: [] });
      useVoiceStore.getState().reset();
    }
  });
}

async function loadInitialHistory(bridge: DesktopBridge, set: SetFn): Promise<void> {
  try {
    const appState = await bridge.getAppState();
    set({ appState });

    if (appState.phase === "logged_out") return;

    const history = await bridge.getAgentHistory();
    if (history.length === 0) return;

    set((s) =>
      s.messages.length === 0 && s.appState.phase !== "logged_out"
        ? { messages: historyToChatMessages(history) }
        : s,
    );
  } catch (err) {
    console.warn("[agent-store] failed to load history:", err);
  }
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export const useAgentStore = create<AgentStore>((set: SetFn, get: GetFn) => ({
  messages: [],
  appState: { phase: "logged_out" },
  queuedFollowUp: [],
  queuedSteering: [],

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};

    const unsubAgent = subscribeAgentEvents(bridge, set);
    const unsubState = subscribeAppState(bridge, set);
    void loadInitialHistory(bridge, set);

    return () => {
      unsubAgent();
      unsubState();
    };
  },

  // --- Agent commands (IPC) -------------------------------------------------

  send: (text, images, options) => {
    const bridge = getBridge();
    if (!bridge) return;

    const busy = isBusy(get().appState);
    const wantsSteer = options?.intent === "steer";
    const cmdType: "user_message" | "follow_up" | "steer" =
      busy && wantsSteer ? "steer" : busy ? "follow_up" : "user_message";

    void bridge.sendAgentCommand({ type: cmdType, text, images });

    const meta: ChatMessageMetadata = {};
    if (cmdType === "steer") meta.steer = true;
    if (images?.length) meta.imageCount = images.length;
    const hasMeta = meta.steer !== undefined || meta.imageCount !== undefined;

    set((s) => ({
      messages: [...s.messages, userMessage(text, hasMeta ? meta : undefined)],
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
    set((s) => ({ messages: [...s.messages, userMessage(text)] }));
  },

  addSteerMessage: (text: string) => {
    set((s) => ({ messages: [...s.messages, userMessage(text, { steer: true })] }));
  },
}));
