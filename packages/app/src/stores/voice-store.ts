import { create } from "zustand";

import { getBridge } from "@repo/app/lib/bridge";
import { VoicePipeline } from "@repo/app/voice/voice-pipeline";
import { VoiceMachine, type VoiceState } from "@repo/app/voice/voice-machine";

type VoiceStore = {
  state: VoiceState;
  /**
   * Whether TTS is configured (ElevenLabs key present), probed at init.
   * null = probe still in flight. While false, no pipeline exists and
   * toggleVoice is a no-op — the dock disables the mic and points at
   * Settings instead of silently doing nothing.
   */
  ttsConfigured: boolean | null;

  init: () => () => void;
  reset: () => void;
  toggleVoice: () => void;
  speakText: (text: string) => void;
  flushSpeech: () => void;
};

const machine = new VoiceMachine();
let pipeline: VoicePipeline | null = null;
let unsubscribeModelState: (() => void) | null = null;
let unsubscribeMachine: (() => void) | null = null;
// In-flight pipeline teardown promise. runConnect awaits this before sending
// a fresh startStt, so a rapid stop/start can't let the prior session's
// stopStt arrive at the main process AFTER the new startSession and
// finalize the wrong stream.
let pendingTeardown: Promise<void> | null = null;

// Listeners for finalized user transcripts. Decoupled from agent-store via
// callback injection so voice-store doesn't have to import (and statically
// depend on) the consumer it would otherwise form a cycle with.
const finalListeners = new Set<(text: string) => void>();

/**
 * Subscribe to finalized user transcripts. The callback fires only for
 * transcripts produced while the machine was in `listening` — tail finals
 * arriving after teardown are dropped. Returns an unsubscribe.
 */
export function onUserTranscript(listener: (text: string) => void): () => void {
  finalListeners.add(listener);
  return () => {
    finalListeners.delete(listener);
  };
}

function trackTeardown(p: Promise<void>): Promise<void> {
  pendingTeardown = p.finally(() => {
    if (pendingTeardown === p) pendingTeardown = null;
  });
  return pendingTeardown;
}

function teardown(): void {
  unsubscribeModelState?.();
  unsubscribeModelState = null;
  if (pipeline) {
    trackTeardown(pipeline.disconnect());
    pipeline = null;
  }
  machine.dispatch({ type: "reset" });
  // Drop the subscriber AFTER the reset dispatch above so the zustand state
  // syncs to idle first.
  unsubscribeMachine?.();
  unsubscribeMachine = null;
}

async function runConnect(): Promise<void> {
  const bridge = getBridge();
  // Capture the pipeline reference at entry. A teardown + re-init while we're
  // awaiting would replace the module-level `pipeline` — operating on the
  // captured ref guarantees we only ever connect/disconnect THIS session.
  const session = pipeline;
  if (!bridge || !session) return;
  const gen = machine.generation;

  // Wait for any prior session's main-process stopSession to land before
  // sending startStt — otherwise IPC interleaving lets the previous stop
  // finalize the new session's recognizer stream.
  if (pendingTeardown) {
    try {
      await pendingTeardown;
    } catch {
      /* prior teardown errors are surfaced via onError, ignore here */
    }
    if (gen !== machine.generation) return;
  }

  // Step 1: probe model availability.
  let status: "ready" | "missing";
  try {
    status = await bridge.getVoiceModelStatus();
  } catch (err) {
    if (gen !== machine.generation) return;
    machine.dispatch({
      type: "model_download_failed",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (gen !== machine.generation) return;
  machine.dispatch({ type: "model_status_received", status });

  // Step 2: download if missing.
  if (status === "missing") {
    let result: Awaited<ReturnType<typeof bridge.downloadVoiceModel>>;
    try {
      result = await bridge.downloadVoiceModel();
    } catch (err) {
      if (gen !== machine.generation) return;
      machine.dispatch({
        type: "model_download_failed",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (gen !== machine.generation) return;
    if (!result.ok) {
      machine.dispatch({
        type: "model_download_failed",
        message: result.error ?? "Failed to download speech model",
      });
      return;
    }
    machine.dispatch({ type: "model_download_ok" });
  }

  // Step 3: pipeline.connect (mic + recognizer).
  try {
    await session.connect();
  } catch (err) {
    if (gen !== machine.generation) return;
    machine.dispatch({
      type: "connect_failed",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (gen !== machine.generation) {
    // Connect succeeded but state moved on — drop the now-orphaned mic on
    // the captured session, never the (possibly replaced) module-level ref.
    trackTeardown(session.disconnect());
    return;
  }
  machine.dispatch({ type: "connect_ok" });
}

export const useVoiceStore = create<VoiceStore>((set, _get) => ({
  state: machine.state,
  ttsConfigured: null,

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};

    let cancelled = false;
    unsubscribeMachine?.();
    unsubscribeMachine = machine.subscribe((s) => set({ state: s }));
    // subscribe() only forwards future transitions. Sync the current machine
    // state into zustand now so a re-mount after a stale callback (e.g. a
    // late pipeline_error pushed the machine off idle) doesn't show stale UI.
    set({ state: machine.state });

    unsubscribeModelState?.();
    unsubscribeModelState = bridge.onVoiceModelState((event) => {
      machine.dispatch({ type: "model_progress", progress: event });
    });

    void bridge
      .isTtsAvailable()
      .catch(() => false)
      .then((available) => {
        if (cancelled) return undefined;
        set({ ttsConfigured: available });
        if (!available) return undefined;
        pipeline = new VoicePipeline({
          onTranscriptPartial: (text) => {
            machine.dispatch({ type: "transcript_partial", text });
          },
          onTranscriptFinal: (text) => {
            // Tail finals from the recognizer can arrive AFTER teardown — the
            // worklet flush + stopStt promise chain resolves asynchronously
            // and may deliver text post-disconnect. Snapshot the state BEFORE
            // dispatch so a stale final on an already-idle machine can't reach
            // the agent.
            const wasListening = machine.state.kind === "listening";
            machine.dispatch({ type: "transcript_final", text });
            if (!wasListening) return;
            for (const listener of finalListeners) listener(text);
          },
          onError: (message) => {
            machine.dispatch({ type: "pipeline_error", message });
          },
        });
        return undefined;
      });

    return () => {
      cancelled = true;
      teardown();
    };
  },

  toggleVoice: () => {
    if (!pipeline) return;
    const state = machine.state;
    if (state.kind === "listening") {
      trackTeardown(pipeline.disconnect());
      machine.dispatch({ type: "pipeline_disconnected" });
      return;
    }
    if (state.kind === "downloading_model" || state.kind === "connecting") return;
    // idle | error → start the dance. runConnect awaits pendingTeardown so
    // a rapid stop/start can't interleave on the main side.
    machine.dispatch({ type: "user_toggle_on" });
    void runConnect();
  },

  speakText: (text: string) => {
    pipeline?.speakText(text);
  },

  flushSpeech: () => {
    pipeline?.flushSpeech();
  },

  reset: () => {
    teardown();
  },
}));
