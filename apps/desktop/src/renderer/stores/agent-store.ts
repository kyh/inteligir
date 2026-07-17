import type { DynamicToolUIPart, TextUIPart, UIMessage } from "ai";
import { create } from "zustand";

import type { AppAgentEvent } from "@repo/features/agent-events";
import { Value } from "@sinclair/typebox/value";

import { AppStateSchema, type AppState } from "@repo/features/app-state";
import type { Bridge, SetupProgress } from "@repo/features/ipc";
import { buildNoteContext, stripNoteContext } from "@repo/features/note-context";
import type { ImageAttachment } from "@repo/features/voice";
import { getBridge } from "@renderer/lib/bridge";
import {
  flushOpenNote,
  openNoteIsPrivate,
  openNotePath,
} from "@renderer/workspace/open-note-flush";
import { onUserTranscript, useVoiceStore } from "@renderer/stores/voice-store";

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
  /** When set, the bubble is styled as a turn-failure surface (red border,
   * "error" copy) and may show an action button based on the kind:
   *   - "auth": inline Re-authenticate link (likely auth/credentials issue)
   *   - "unknown": just the error text (pi-reported error of unspecified cause)
   * The text content is the human-readable error message. */
  errorKind?: "auth" | "unknown";
};

export type ChatMessage = UIMessage<ChatMessageMetadata>;

/**
 * The messages of the CURRENT turn: everything after the last non-steer user
 * message (steer nudges ride mid-turn and don't reset the boundary). This is
 * the one place the turn-boundary rule lives — every consumer that asks "what
 * is the agent doing right now" (thinking flag, activity label) derives from
 * this slice instead of re-walking with its own copy of the steer exception.
 */
export function currentTurnMessages(messages: ChatMessage[]): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === "user" && !msg.metadata?.steer) return messages.slice(i + 1);
  }
  return messages;
}

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

function toolPartRunning(toolCallId: string, toolName: string, args: unknown): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolCallId,
    toolName,
    state: "input-available",
    input: args,
  };
}

function toolPartDone(
  toolCallId: string,
  toolName: string,
  args: unknown,
  resultText: string,
): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolCallId,
    toolName,
    state: "output-available",
    input: args,
    output: resultText,
  };
}

function toolPartError(
  toolCallId: string,
  toolName: string,
  args: unknown,
  errorText: string,
): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    toolCallId,
    toolName,
    state: "output-error",
    input: args,
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
    const reason = err instanceof Error ? err.message : "The message could not be submitted.";
    const msg: ChatMessage = {
      ...assistantTextMessage(`Your message wasn't delivered: ${reason}`),
      metadata: { errorKind: "unknown" },
    };
    set((s) => ({ messages: [...s.messages, msg] }));
  });
}

// ---------------------------------------------------------------------------
// Persisted-history → UIMessage[] conversion
// ---------------------------------------------------------------------------

function historyToChatMessages(
  history: Awaited<ReturnType<Bridge["getAgentHistory"]>>,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const entry of history) {
    switch (entry.role) {
      case "user":
        messages.push(userMessage(stripNoteContext(entry.text)));
        break;
      case "assistant":
        messages.push(assistantTextMessage(entry.text));
        break;
      case "tool":
        // Tool activity is ephemeral chat-surface decoration during the live
        // turn. Once the turn ends the live store sweeps these messages
        // (agent_end); on rehydrate we skip them entirely so reloaded
        // history matches the post-sweep state.
        break;
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

function subscribeAgentEvents(bridge: Bridge, set: SetFn): () => void {
  let streamingMsgId: string | null = null;
  const toolMsgIds = new Map<string, string>();

  return bridge.onAgentEvent((event: AppAgentEvent) => {
    switch (event.type) {
      case "agent_end": {
        streamingMsgId = null;
        // Sweep the tool messages we created during this turn — only the
        // final assistant answer (and the user's prompt) should remain on
        // the chat surface. The activity rows are an ephemeral progress
        // indicator, not part of the persisted conversation.
        const sweepIds = new Set(toolMsgIds.values());
        toolMsgIds.clear();
        set((s) => ({
          messages: sweepIds.size > 0 ? s.messages.filter((m) => !sweepIds.has(m.id)) : s.messages,
          queuedFollowUp: [],
          queuedSteering: [],
        }));
        break;
      }

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
        if (voice.state.kind === "listening") voice.speakText(delta);
        break;
      }

      case "message_end": {
        if (streamingMsgId === null || event.role !== "assistant") break;
        const sid = streamingMsgId;
        const { text } = event;
        // Error turn: keep the bubble, tag with errorKind, use errorMessage
        // (or fall back to text) so the failure is visible instead of dropped.
        // Cause is unknown from pi's perspective — don't claim it's auth.
        if (event.stopReason === "error") {
          const errText =
            event.errorMessage ?? (text.length > 0 ? text : "The model returned no response.");
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === sid
                ? {
                    ...mapMessageWithTextPart(m, () => textPart(errText)),
                    metadata: { ...m.metadata, errorKind: "unknown" },
                  }
                : m,
            ),
          }));
        } else if (text.length === 0) {
          // Tool-only assistant turns emit message_start/message_end with empty
          // text. Drop those empty bubbles so the "Thinking..." shimmer doesn't
          // linger between/after tool calls — the tool messages themselves
          // already represent the agent's activity.
          set((s) => ({ messages: s.messages.filter((m) => m.id !== sid) }));
        } else {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === sid ? mapMessageWithTextPart(m, () => textPart(text)) : m,
            ),
          }));
        }
        streamingMsgId = null;
        const voice = useVoiceStore.getState();
        if (voice.state.kind === "listening") voice.flushSpeech();
        break;
      }

      case "turn_error": {
        // Empty-turn fallback from main. Create a fresh assistant bubble
        // tagged with the error kind so the chat shows the failure (and the
        // inline Re-authenticate link, if kind === "auth").
        const msg: ChatMessage = {
          ...assistantTextMessage(event.reason),
          metadata: { errorKind: event.kind },
        };
        set((s) => ({ messages: [...s.messages, msg] }));
        break;
      }

      case "tool_execution_start": {
        const msg = assistantToolMessage(
          toolPartRunning(event.toolCallId, event.toolName, event.args),
        );
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
            // Preserve args (input) captured at start — tool_execution_end
            // doesn't re-send them.
            const next = event.isError
              ? toolPartError(first.toolCallId, first.toolName, first.input, event.resultText)
              : toolPartDone(first.toolCallId, first.toolName, first.input, event.resultText);
            return replaceToolPart(m, next);
          }),
        }));
        break;
      }
    }
  });
}

function subscribeAppState(bridge: Bridge, set: SetFn): () => void {
  return bridge.onAppState((appState: unknown) => {
    if (!Value.Check(AppStateSchema, appState)) return;
    set({ appState });

    if (appState.phase === "logged_out") {
      set({ messages: [], queuedFollowUp: [], queuedSteering: [], setupProgress: null });
      useVoiceStore.getState().reset();
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
  messages: [],
  appState: { phase: "logged_out" },
  setupProgress: null,
  queuedFollowUp: [],
  queuedSteering: [],

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};

    const unsubAgent = subscribeAgentEvents(bridge, set);
    const unsubState = subscribeAppState(bridge, set);
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
    if (!bridge) return { flushed: true };

    const busy = isBusy(get().appState);
    const wantsSteer = options?.intent === "steer";
    const cmdType: "user_message" | "follow_up" | "steer" =
      busy && wantsSteer ? "steer" : busy ? "follow_up" : "user_message";

    const meta: ChatMessageMetadata = {};
    if (cmdType === "steer") meta.steer = true;
    if (images?.length) meta.imageCount = images.length;
    const hasMeta = Object.keys(meta).length > 0;

    set((s) => ({
      messages: [...s.messages, userMessage(text, hasMeta ? meta : undefined)],
    }));

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
      // The flush may have awaited a moment — bail if the session ended meanwhile
      // (e.g. a voice turn queued behind a flush while the user logged out).
      if (get().appState.phase === "logged_out") return { flushed };
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
      ?.sendAgentCommand({ type: "interrupt" })
      .catch(() => {});
  },

  newSession: async () => {
    set({ messages: [], queuedFollowUp: [], queuedSteering: [] });
    await getBridge()?.transition({ type: "NEW_SESSION" });
  },
}));
