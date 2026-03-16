import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import { AudioCapture } from "@/renderer/lib/audio-capture";
import { AudioPlaybackManager } from "@/renderer/lib/audio-playback";
import { useAgentStore } from "@/renderer/stores/agent-store";
import type { VoiceEvent, VoiceSessionState } from "@/shared/voice";

// ---------------------------------------------------------------------------
// Store
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

let audioCapture: AudioCapture | null = null;
let audioPlayback: AudioPlaybackManager | null = null;

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  sessionState: "inactive",
  currentTranscript: "",
  isConfigured: false,
  error: null,

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};

    audioPlayback = new AudioPlaybackManager();

    const unsub = bridge.onVoiceEvent((raw: unknown) => {
      const event = raw as VoiceEvent;

      switch (event.type) {
        case "voice:state":
          set({ sessionState: event.state, error: event.error ?? null });

          // Start/stop mic capture based on state
          if (event.state === "listening" && !audioCapture) {
            audioCapture = new AudioCapture();
            void audioCapture.start().catch((err) => {
              console.error("[voice] mic error:", err);
              set({ error: "Microphone access denied" });
              void bridge.stopVoice();
            });
          } else if (event.state === "inactive" || event.state === "error") {
            audioCapture?.stop();
            audioCapture = null;
            audioPlayback?.interrupt();
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
          void audioPlayback?.enqueue(event.audio);
          break;

        case "voice:tts-done":
          // Playback continues from queue; no action needed
          break;
      }
    });

    void get().loadSettings();
    return () => {
      unsub();
      audioCapture?.stop();
      audioCapture = null;
      audioPlayback?.interrupt();
      audioPlayback = null;
    };
  },

  toggleVoice: () => {
    const bridge = getBridge();
    if (!bridge) return;
    const { sessionState } = get();

    if (sessionState === "inactive") {
      void bridge.startVoice();
    } else {
      audioCapture?.stop();
      audioCapture = null;
      audioPlayback?.interrupt();
      void bridge.stopVoice();
    }
  },

  interruptTts: () => {
    audioPlayback?.interrupt();
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
