import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import { VoicePipeline } from "@/renderer/voice/voice-pipeline";
import { VoiceMachine, type VoiceState } from "@/renderer/voice/voice-machine";

type VoiceStore = {
  state: VoiceState;

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

function teardown(): void {
  unsubscribeModelState?.();
  unsubscribeModelState = null;
  pipeline?.disconnect();
  pipeline = null;
  machine.dispatch({ type: "reset" });
  // Run the machine subscriber AFTER the reset dispatch above so the zustand
  // state syncs to idle, then drop it. Direct reset() calls used to leak this
  // subscriber across reinit cycles.
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
    session.disconnect();
    return;
  }
  machine.dispatch({ type: "connect_ok" });
}

export const useVoiceStore = create<VoiceStore>((set, _get) => ({
  state: machine.state,

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

    void bridge.getVoiceConfig().then((config) => {
      if (cancelled || !config) return;
      pipeline = new VoicePipeline({
        elevenlabsApiKey: config.elevenlabsApiKey,
        elevenlabsVoiceId: config.elevenlabsVoiceId,
        onTranscriptPartial: (text) => {
          machine.dispatch({ type: "transcript_partial", text });
        },
        onTranscriptFinal: (text) => {
          machine.dispatch({ type: "transcript_final", text });
          void bridge.sendAgentCommand({ type: "user_message", text });
          void import("@/renderer/stores/agent-store").then(({ useAgentStore }) => {
            useAgentStore.getState().addUserMessage(text);
          });
        },
        onError: (message) => {
          machine.dispatch({ type: "pipeline_error", message });
        },
      });
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
      pipeline.disconnect();
      machine.dispatch({ type: "pipeline_disconnected" });
      return;
    }
    if (state.kind === "downloading_model" || state.kind === "connecting") return;
    // idle | error → start the dance.
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
