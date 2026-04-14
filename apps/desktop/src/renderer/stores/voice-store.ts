import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import { VoicePipeline, type VoicePipelineEvent } from "@/renderer/voice/voice-pipeline";
import type { VoiceSessionState } from "@/shared/voice";

// ---------------------------------------------------------------------------
// Store — manages voice pipeline lifecycle (Deepgram STT + ElevenLabs TTS)
// ---------------------------------------------------------------------------

type VoiceStore = {
  sessionState: VoiceSessionState;
  currentTranscript: string;
  error: string | null;

  init: () => () => void;
  reset: () => void;
  toggleVoice: () => void;
  speakText: (text: string) => void;
  flushSpeech: () => void;
  interruptSpeech: () => void;
};

let pipeline: VoicePipeline | null = null;

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  sessionState: "inactive",
  currentTranscript: "",
  error: null,

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};

    let cancelled = false;

    void bridge.getVoiceConfig().then((config) => {
      if (cancelled || !config) return;
      pipeline = new VoicePipeline(config);
      pipeline.on(handlePipelineEvent);
    });

    function handlePipelineEvent(event: VoicePipelineEvent) {
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
      pipeline?.disconnect();
      pipeline = null;
    };
  },

  toggleVoice: () => {
    if (!pipeline) return;
    const { sessionState } = get();
    if (sessionState === "inactive" || sessionState === "error") {
      void pipeline.connect();
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

  interruptSpeech: () => {
    pipeline?.interruptSpeech();
  },

  reset: () => {
    pipeline?.disconnect();
    set({ sessionState: "inactive", currentTranscript: "", error: null });
  },
}));
