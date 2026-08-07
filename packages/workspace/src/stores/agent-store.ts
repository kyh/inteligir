import { create, type StoreApi } from "zustand";

import type { AppAgentEvent } from "@repo/bridge/agent-events";
import { Value } from "@sinclair/typebox/value";

import { AppStateSchema, type AppState } from "@repo/bridge/app-state";
import {
  appendNotice,
  appendUser,
  applyAgentEvent,
  emptyChatLog,
  logFromHistory,
  type ChatLog,
} from "@repo/bridge/chat-log";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import type { Bridge, SetupProgress } from "@repo/bridge/ipc-registry";
import { buildNoteContext } from "@repo/bridge/note-context";
import type { ImageAttachment } from "@repo/bridge/chat-message";
import { getBridge } from "@repo/bridge/client";
import {
  projectChatLog,
  type ChatMessage,
  type ChatMessageMetadata,
} from "@repo/workspace/stores/chat-log-view";
import { flushOpenNote, openNoteIsPrivate, openNotePath } from "@repo/editor/note/open-note-flush";
import { useAiProviderStore } from "@repo/editor/stores/ai-provider-store";
// ---------------------------------------------------------------------------
// Assistant-stream taps. Voice narration is an OPTIONAL capability, so it
// subscribes here instead of the core chat store importing its store and
// poking at it — deleting the voice surface must not touch this file. The wiring in
// the other direction (a finished transcript becoming a user turn) lives with
// voice too: @repo/workspace/voice/narration.ts, installed once by app-root.
// ---------------------------------------------------------------------------

/** `delta`/`end` track a streaming assistant reply; `reset` means the chat was
 * wiped (a new session) and any dependent surface should drop its state. */
export type AssistantStreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "end" }
  | { kind: "reset" };

const assistantStreamListeners = new Set<(event: AssistantStreamEvent) => void>();

/** Subscribe to the streamed assistant reply. Returns unsubscribe. */
export function onAssistantStream(listener: (event: AssistantStreamEvent) => void): () => void {
  assistantStreamListeners.add(listener);
  return () => {
    assistantStreamListeners.delete(listener);
  };
}

function emitAssistantStream(event: AssistantStreamEvent): void {
  for (const listener of assistantStreamListeners) listener(event);
}

// ---------------------------------------------------------------------------
// The chat surface is the SHARED @repo/bridge/chat-log fold, projected into AI
// SDK UIMessages by @repo/workspace/stores/chat-log-view. This store owns the
// workspace-only halves: the per-item metadata (steer, image count), queue
// state, voice side effects, and the Bridge command routing.
// ---------------------------------------------------------------------------

type SendOptions = {
  intent?: "steer";
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// The set/get the subscription helpers below take. Derived from zustand's own
// StoreApi rather than hand-written: a hand-rolled pair drifts from it (losing
// the `replace` overload and the whole-state partial), and that inference loss
// is exactly what the curried `create<T>()(...)` form exists to prevent.
type SetFn = StoreApi<AgentStore>["setState"];
type GetFn = StoreApi<AgentStore>["getState"];

type AgentStore = {
  /** The shared platform-neutral chat log — source of truth for the surface. */
  log: ChatLog;
  /** Per-item surface metadata (steer flag, image count), by item id. Written
   * once when the item is appended; reset with the log. */
  chatMeta: ReadonlyMap<string, ChatMessageMetadata>;
  /** Derived: `log` projected into UIMessages (identity-stable per item). */
  messages: ChatMessage[];
  appState: AppState;
  /** Latest setup progress, or null before any event arrives. */
  setupProgress: SetupProgress | null;
  /** Queued messages reported by pi (steer + followUp). Cleared on agent_end. */
  queuedFollowUp: string[];
  queuedSteering: string[];

  init: () => () => void;
  /**
   * Dispatch a user submission. The store reads the live agent state at call
   * time and routes to the right IPC command (`user_message` / `follow_up` /
   * `steer`), so callers don't need to track busy themselves.
   */
  send: (
    text: string,
    images?: ImageAttachment[],
    options?: SendOptions,
  ) => Promise<{ flushed: boolean }>;
  interrupt: () => void;
  newSession: () => Promise<void>;
};

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

/** The chat-surface slice for a new log: fold result + reprojected messages. */
function chatState(
  log: ChatLog,
  chatMeta: ReadonlyMap<string, ChatMessageMetadata>,
): Pick<AgentStore, "log" | "chatMeta" | "messages"> {
  return { log, chatMeta, messages: projectChatLog(log, chatMeta) };
}

/**
 * Submit a command and surface a failure in the chat instead of swallowing
 * it. The optimistic user bubble has already been appended by the caller —
 * without this, a rejected submission (IPC validation, agent mid-restart)
 * leaves the message rendered as sent while it never reached the agent.
 */
function sendCommandSurfacingFailure(
  bridge: Bridge,
  set: SetFn,
  command: Parameters<Bridge["sendAgentCommand"]>[0],
): void {
  void bridge.sendAgentCommand(command).catch((err: unknown) => {
    const reason = toErrorMessage(err, "The message could not be submitted.");
    set((s) =>
      chatState(appendNotice(s.log, `Your message wasn't delivered: ${reason}`), s.chatMeta),
    );
  });
}

// ---------------------------------------------------------------------------
// Subscription handlers (split out of init() for readability)
// ---------------------------------------------------------------------------

function subscribeAgentEvents(bridge: Bridge, set: SetFn, get: GetFn): () => void {
  return bridge.onAgentEvent((event: AppAgentEvent) => {
    // Pre-fold streaming state gates the voice side effects below — the same
    // "is a reply mid-stream" check the inline fold kept in a closure.
    const wasStreaming = get().log.streamingId !== null;

    set((s) => {
      const log = applyAgentEvent(s.log, event);
      const chat = log === s.log ? null : chatState(log, s.chatMeta);
      // Surface-only state riding the same update: queue bookkeeping.
      if (event.type === "agent_end") {
        return { ...chat, queuedFollowUp: [], queuedSteering: [] };
      }
      if (event.type === "queue_update") {
        // Skip the set() if the queue is identical to what we already hold.
        // pi can re-emit queue_update for unrelated mutations; an
        // unconditional set re-renders every Composer subscriber.
        return sameStrings(s.queuedFollowUp, event.followUp) &&
          sameStrings(s.queuedSteering, event.steering)
          ? s
          : { queuedFollowUp: event.followUp, queuedSteering: event.steering };
      }
      return chat ?? s;
    });

    // Broadcast the streamed reply for optional consumers (voice narration).
    // The chat store does NOT know who is listening — see onAssistantStream.
    if (event.type === "message_update" && wasStreaming) {
      emitAssistantStream({ kind: "delta", text: event.delta });
    } else if (event.type === "message_end" && wasStreaming && event.role === "assistant") {
      emitAssistantStream({ kind: "end" });
    }
  });
}

function subscribeAppState(bridge: Bridge, set: SetFn, get: GetFn): () => void {
  return bridge.onAppState((appState: unknown) => {
    if (!Value.Check(AppStateSchema, appState)) return;
    const wasReady = get().appState.phase === "ready";
    set({ appState });
    // Entering ready (boot setup done, reset-app-data finished, retry
    // recovered) can mean the world behind the AI-provider snapshot changed —
    // a reset wipes provider credentials entirely. Refresh the shared store
    // so the composer affordance and editor gates reflect the new truth.
    // Ready→ready churn (agent busy/idle) is excluded on purpose.
    if (!wasReady && appState.phase === "ready") {
      void useAiProviderStore
        .getState()
        .refresh()
        .catch(() => {});
    }
  });
}

function subscribeSetupProgress(bridge: Bridge, set: SetFn): () => void {
  return bridge.onSetupProgress((progress) => {
    set({ setupProgress: progress });
  });
}

// Bumped whenever the chat surface is INTENTIONALLY cleared (new session,
// reset-app-data) so a history fetch still in flight can't land afterward and
// resurrect the cleared transcript. The empty-log check alone can't catch
// that race: a just-cleared log is exactly as empty as a fresh boot's.
let chatGeneration = 0;

async function loadInitialHistory(bridge: Bridge, set: SetFn): Promise<void> {
  const generation = chatGeneration;
  try {
    const appState = await bridge.getAppState();
    set({ appState });

    const history = await bridge.getAgentHistory();
    if (history.length === 0) return;

    // Drop a stale response outright (cleared while the fetch was in flight),
    // and even a current one only seeds an EMPTY log.
    if (generation !== chatGeneration) return;
    set((s) => (s.log.items.length === 0 ? chatState(logFromHistory(history), s.chatMeta) : s));
  } catch (err) {
    console.warn("[agent-store] failed to load history:", err);
  }
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export const useAgentStore = create<AgentStore>()((set, get) => ({
  log: emptyChatLog,
  chatMeta: new Map(),
  messages: [],
  appState: { phase: "starting" },
  setupProgress: null,
  queuedFollowUp: [],
  queuedSteering: [],

  init: () => {
    const bridge = getBridge();

    const unsubAgent = subscribeAgentEvents(bridge, set, get);
    const unsubState = subscribeAppState(bridge, set, get);
    const unsubProgress = subscribeSetupProgress(bridge, set);
    void loadInitialHistory(bridge, set);

    return () => {
      unsubAgent();
      unsubState();
      unsubProgress();
    };
  },

  // --- Agent commands (IPC) -------------------------------------------------

  // The single entry point for sending a user turn — typed (composer) or voice.
  // Both go through here so the flush-then-contextualize behavior can't diverge.
  // Returns `flushed` so a UI caller can warn; resolves once dispatched.
  send: async (text, images, options) => {
    const bridge = getBridge();

    const busy = isBusy(get().appState);
    const wantsSteer = options?.intent === "steer";
    const cmdType: "user_message" | "follow_up" | "steer" =
      busy && wantsSteer ? "steer" : busy ? "follow_up" : "user_message";

    const meta: ChatMessageMetadata = {};
    if (cmdType === "steer") meta.steer = true;
    if (images?.length) meta.imageCount = images.length;
    const hasMeta = Object.keys(meta).length > 0;

    set((s) => {
      const log = appendUser(s.log, text);
      const added = log.items[log.items.length - 1];
      const chatMeta =
        hasMeta && added !== undefined ? new Map(s.chatMeta).set(added.id, meta) : s.chatMeta;
      return chatState(log, chatMeta);
    });

    // The displayed bubble stays the user's plain text. Only a FRESH user turn
    // carries the open note: flush it so the agent reads the latest bytes, and
    // tag the turn with which file "this note" means — but only if the save
    // actually landed, so a failed flush never points the agent at stale bytes.
    // (steer/follow-up nudges ride an already-established turn, so they skip it.)
    let sentText = text;
    let flushed = true;
    if (cmdType === "user_message") {
      flushed = await flushOpenNote();
      // A private note's PATH is a leak too — omit the context hint entirely
      // (the date-only prefix still rides). Fail-closed on the renderer buffer
      // (openNoteIsPrivate — true when unregistered or unreadable), which
      // honors a just-typed `private: true` before any save. That buffer is the
      // only gate: the host does not model note privacy, so a flip that landed
      // somewhere else is not seen here.
      const activeNote =
        flushed && !openNoteIsPrivate() ? (openNotePath() ?? undefined) : undefined;
      sentText = buildNoteContext(text, activeNote);
      // The flush may have awaited a moment — bail if the world is being torn
      // down/rebuilt meanwhile (a reset or retry kicked in while a voice turn
      // was queued behind the flush): the agent is definitionally absent and
      // the chat may have just been cleared.
      if (get().appState.phase === "setting_up") return { flushed };
    }

    sendCommandSurfacingFailure(bridge, set, {
      type: cmdType,
      text: sentText,
      ...(images === undefined ? {} : { images }),
    });
    return { flushed };
  },

  interrupt: () => {
    // Benign if it fails (nothing running to interrupt) — main returns the
    // real submission promise, so swallow the rejection.
    void getBridge()
      .sendAgentCommand({ type: "interrupt" })
      .catch(() => {});
  },

  newSession: async () => {
    chatGeneration++; // invalidate any in-flight history load
    set({ ...chatState(emptyChatLog, new Map()), queuedFollowUp: [], queuedSteering: [] });
    // Announced before the host is asked: a narration buffer holding the tail
    // of the thread being replaced must not speak into the new one.
    emitAssistantStream({ kind: "reset" });
    await getBridge().transition({ type: "NEW_SESSION" });
  },
}));
