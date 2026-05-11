import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import { VoicePipeline, type VoicePipelineEvent } from "@/renderer/voice/voice-pipeline";
import type { VoiceModelStateEvent } from "@/shared/ipc";
import type { VoiceSessionState } from "@/shared/voice";

type VoiceStore = {
  sessionState: VoiceSessionState;
  currentTranscript: string;
  error: string | null;
  modelState: VoiceModelStateEvent | null;

  init: () => () => void;
  reset: () => void;
  toggleVoice: () => void;
  speakText: (text: string) => void;
  flushSpeech: () => void;
};

let pipeline: VoicePipeline | null = null;

async function ensureModelThenConnect(
  set: (patch: Partial<VoiceStore>) => void,
): Promise<void> {
  const bridge = getBridge();
  if (!bridge || !pipeline) return;

  try {
    const status = await bridge.getVoiceModelStatus();
    if (!pipeline) return;
    if (status === "ready") {
      void pipeline.connect();
      return;
    }

    set({ sessionState: "downloading_model", error: null });
    const result = await bridge.downloadVoiceModel();
    if (!pipeline) return;
    if (result.ok) {
      void pipeline.connect();
    } else {
      set({
        sessionState: "error",
        error: result.error ?? "Failed to download speech model",
      });
    }
  } catch (err) {
    if (!pipeline) return;
    set({
      sessionState: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  sessionState: "inactive",
  currentTranscript: "",
  error: null,
  modelState: null,

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};

    let cancelled = false;

    const unsubscribeModelState = bridge.onVoiceModelState((event) => {
      set({ modelState: event });
    });

    void bridge.getVoiceConfig().then((config) => {
      if (cancelled || !config) return;
      pipeline = new VoicePipeline(config);
      pipeline.on(handlePipelineEvent);
    });

    function handlePipelineEvent(this: void, event: VoicePipelineEvent) {
      if (!bridge) return;
      switch (event.type) {
        case "state_changed":
          set({
            sessionState: event.state,
            error: event.error ?? null,
            ...(event.state === "inactive" ? { currentTranscript: "" } : {}),
          });
          break;
        case "transcript_partial":
          set({ currentTranscript: event.text });
          break;
        case "transcript_final":
          set({ currentTranscript: "" });
          if (event.text) {
            void bridge.sendAgentCommand({ type: "user_message", text: event.text });
            void import("@/renderer/stores/agent-store").then(({ useAgentStore }) => {
              useAgentStore.getState().addUserMessage(event.text);
            });
          }
          break;
      }
    }

    return () => {
      cancelled = true;
      unsubscribeModelState();
      pipeline?.disconnect();
      pipeline = null;
      // Reset transient state so a remount doesn't inherit "downloading_model"
      // / "connecting" / etc. from an in-flight teardown.
      set({ sessionState: "inactive", currentTranscript: "", error: null });
    };
  },

  toggleVoice: () => {
    if (!pipeline) return;
    const { sessionState } = get();
    if (sessionState === "downloading_model") return;
    if (sessionState === "inactive" || sessionState === "error") {
      void ensureModelThenConnect(set);
    } else {
      pipeline.disconnect();
    }
  },

  speakText: (text: string) => {
    pipeline?.speakText(text);
  },

  flushSpeech: () => {
    pipeline?.flushSpeech();
  },

  reset: () => {
    pipeline?.disconnect();
    set({ sessionState: "inactive", currentTranscript: "", error: null });
  },
}));
