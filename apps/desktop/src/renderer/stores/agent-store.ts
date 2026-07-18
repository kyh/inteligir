import { create } from "zustand";

import type { AppAgentEvent } from "@repo/features/agent-events";
import { Value } from "@sinclair/typebox/value";

import { AppStateSchema, type AppState } from "@repo/features/app-state";
import {
  appendNotice,
  appendUser,
  applyAgentEvent,
  emptyChatLog,
  logFromHistory,
  type ChatLog,
} from "@repo/features/chat-log";
import { toErrorMessage } from "@repo/features/ipc";
import type { Bridge, SetupProgress } from "@repo/features/ipc-registry";
import { buildNoteContext } from "@repo/features/note-context";
import type { ImageAttachment } from "@repo/features/voice";
import { getBridge } from "@renderer/lib/bridge";
import {
  projectChatLog,
  type ChatMessage,
  type ChatMessageMetadata,
} from "@renderer/stores/chat-log-view";
import {
  flushOpenNote,
  openNoteIsPrivate,
  openNotePath,
} from "@renderer/workspace/open-note-flush";
import { useAiProviderStore } from "@renderer/stores/ai-provider-store";
import { onUserTranscript, useVoiceStore } from "@renderer/stores/voice-store";

// ---------------------------------------------------------------------------
// The chat surface is the SHARED @repo/features/chat-log fold (the same
// reducer the mobile app renders), projected into AI SDK UIMessages by
// @renderer/stores/chat-log-view. This store owns the desktop-only halves:
// the per-item metadata (steer, image count), queue state, voice side
// effects, and the IPC command routing.
// ---------------------------------------------------------------------------

type SendOptions = {
  intent?: "steer";
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type SetFn = (
  partial: Partial<AgentStore> | ((state: AgentStore) => Partial<AgentStore> | AgentStore),
) => void;
type GetFn = () => AgentStore;

type AgentStore = {
  /** The shared platform-neutral chat log — source of truth for the surface. */
  log: ChatLog;
  /** Desktop-only per-item metadata (steer flag, image count), by item id.
   * Written once when the item is appended; reset with the log. */
  chatMeta: ReadonlyMap<string, ChatMessageMetadata>;
  /** Derived: `log` projected into UIMessages (identity-stable per item). */
  messages: ChatMessage[];
  appState: AppState;
  /** Latest onboarding setup progress, or null before the first event arrives. */
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
  /** "Reset app data" (Settings): clear the chat surface locally, then ask the
   * host for the full ~/.inteligir wipe + re-setup (RESET_APP_DATA). */
  resetAppData: () => Promise<void>;
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
      // Desktop-only state riding the same update: queue bookkeeping.
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

    // Voice narration follows the streamed reply (desktop-only side effect).
    if (event.type === "message_update" && wasStreaming) {
      const voice = useVoiceStore.getState();
      if (voice.state.kind === "listening") voice.speakText(event.delta);
    } else if (event.type === "message_end" && wasStreaming && event.role === "assistant") {
      const voice = useVoiceStore.getState();
      if (voice.state.kind === "listening") voice.flushSpeech();
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

async function loadInitialHistory(bridge: Bridge, set: SetFn): Promise<void> {
  try {
    const appState = await bridge.getAppState();
    set({ appState });

    const history = await bridge.getAgentHistory();
    if (history.length === 0) return;

    // Only seed an empty log — a reset/new-session that raced this fetch has
    // already cleared the chat and must not be resurrected with stale history.
    set((s) => (s.log.items.length === 0 ? chatState(logFromHistory(history), s.chatMeta) : s));
  } catch (err) {
    console.warn("[agent-store] failed to load history:", err);
  }
}

/** LIVE host-side disk probe for the context hint — the same fail-closed
 * probe the agent tool gate uses (vault:probe-note-privacy). Only a note
 * that reads "public" on disk RIGHT NOW may have its path attached;
 * absent, indeterminate, private, and a failed probe all suppress it. */
async function noteIsPublicOnDisk(bridge: Bridge, path: string): Promise<boolean> {
  try {
    return (await bridge.probeNotePrivacy({ path })) === "public";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export const useAgentStore = create<AgentStore>((set: SetFn, get: GetFn) => ({
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
    // A completed voice transcript is just a user turn: route it through the
    // SAME send() as a typed message, so flush, note-context, failed-flush
    // handling and the logout bail all live in one place and can't drift. Serialize
    // so rapid transcripts dispatch (and their bubbles append) in spoken order;
    // send() is async, so without the chain two could race.
    let voiceChain: Promise<unknown> = Promise.resolve();
    const unsubVoice = onUserTranscript((text) => {
      voiceChain = voiceChain.then(() => get().send(text)).catch(() => undefined);
    });
    void loadInitialHistory(bridge, set);

    return () => {
      unsubAgent();
      unsubState();
      unsubProgress();
      unsubVoice();
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
      // (the date-only prefix still rides). Fail-closed twice over: the
      // renderer-buffer check (openNoteIsPrivate — true when unregistered or
      // unreadable) honors a just-typed `private: true` before any save, and
      // the host-side LIVE-disk probe catches an EXTERNAL flip (sync pull,
      // agent write, second editor) the stale buffer can't see — the
      // open-note watcher reloads asynchronously, and flush is a no-op on a
      // clean buffer, so neither would notice the flip in time.
      const bufferPublicPath = flushed && !openNoteIsPrivate() ? openNotePath() : null;
      const activeNote =
        bufferPublicPath !== null && (await noteIsPublicOnDisk(bridge, bufferPublicPath))
          ? bufferPublicPath
          : undefined;
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
    // Benign if it fails (nothing running to interrupt) — swallow the
    // rejection now that main returns the real submission promise.
    void getBridge()
      .sendAgentCommand({ type: "interrupt" })
      .catch(() => {});
  },

  newSession: async () => {
    set({ ...chatState(emptyChatLog, new Map()), queuedFollowUp: [], queuedSteering: [] });
    await getBridge().transition({ type: "NEW_SESSION" });
  },

  resetAppData: async () => {
    set({
      ...chatState(emptyChatLog, new Map()),
      queuedFollowUp: [],
      queuedSteering: [],
      setupProgress: null,
    });
    useVoiceStore.getState().reset();
    await getBridge().transition({ type: "RESET_APP_DATA" });
  },
}));
