import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import { VoiceAudioManager } from "@/renderer/lib/voice-audio-manager";
import { useAgentStore } from "@/renderer/stores/agent-store";
import type { VoiceEvent, VoiceSessionState } from "@/shared/voice";

// ---------------------------------------------------------------------------
// Store — pure state + IPC coordination; audio lifecycle is in VoiceAudioManager
// ---------------------------------------------------------------------------

type VoiceStore = {
  sessionState: VoiceSessionState;
  currentTranscript: string;
  isConfigured: boolean;
  error: string | null;

  init: () => () => void;
  toggleVoice: () => void;
  interruptTts: () => void;
  loadSettings: () => Promise<void>;
};

// Module-level singleton — safe for single-window Electron app.
// init() cleanup nulls this out, so re-init (e.g. hot-reload) is handled.
let audioManager: VoiceAudioManager | null = null;

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  sessionState: "inactive",
  currentTranscript: "",
  isConfigured: false,
  error: null,

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};

    audioManager = new VoiceAudioManager();

    const unsub = bridge.onVoiceEvent((raw: unknown) => {
      const event = raw as VoiceEvent;

      switch (event.type) {
        case "voice:state":
          set({ sessionState: event.state, error: event.error ?? null });

          if (event.state === "listening") {
            void audioManager?.startCapture().catch((err) => {
              console.error("[voice] mic error:", err);
              set({ error: "Microphone access denied" });
              void bridge.stopVoice();
            });
          } else if (event.state === "inactive" || event.state === "error") {
            audioManager?.stopCapture();
            audioManager?.interruptPlayback();
          }
          break;

        case "voice:transcript":
          if (event.isFinal) {
            set({ currentTranscript: "" });
            if (event.text.trim()) {
              useAgentStore.getState().addUserMessage(event.text.trim());
            }
          } else {
            set({ currentTranscript: event.text });
          }
          break;

        case "voice:tts-chunk":
          void audioManager?.enqueueAudio(event.audio);
          break;

        case "voice:tts-done":
          // Intentionally empty — playback drains from its own queue.
          // State transitions are driven by voice:state events from main.
          break;
      }
    });

    void get().loadSettings();
    return () => {
      unsub();
      audioManager?.dispose();
      audioManager = null;
    };
  },

  toggleVoice: () => {
    const bridge = getBridge();
    if (!bridge) return;
    const { sessionState } = get();

    if (sessionState === "inactive") {
      void bridge.startVoice();
    } else {
      audioManager?.stopCapture();
      audioManager?.interruptPlayback();
      void bridge.stopVoice();
    }
  },

  interruptTts: () => {
    audioManager?.interruptPlayback();
    getBridge()?.interruptTts();
  },

  loadSettings: async () => {
    const bridge = getBridge();
    if (!bridge) return;
    const settings = await bridge.getVoiceSettings();
    set({
      isConfigured:
        settings !== null &&
        typeof settings.apiKey === "string" &&
        settings.apiKey.length > 0,
    });
  },
}));
