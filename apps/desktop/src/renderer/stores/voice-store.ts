import { create } from "zustand";

import { AudioCapture } from "@/renderer/lib/audio-capture";
import { AudioPlaybackManager } from "@/renderer/lib/audio-playback";
import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";
import type { VoiceEvent, VoiceSessionState } from "@/shared/voice";

type VoiceStore = {
  sessionState: VoiceSessionState;
  currentTranscript: string;
  isConfigured: boolean;
  error: string | null;

  init: () => () => void;
  toggleVoice: () => void;
  loadSettings: () => Promise<void>;
};

// Module-level singletons — safe for single-window Electron app.
// init() early-returns if already set, preventing duplicates.
let capture: AudioCapture | null = null;
let playback: AudioPlaybackManager | null = null;

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  sessionState: "inactive",
  currentTranscript: "",
  isConfigured: false,
  error: null,

  init: () => {
    if (playback) return () => {}; // already initialized

    const bridge = getBridge();
    if (!bridge) return () => {};

    playback = new AudioPlaybackManager();

    const unsub = bridge.onVoiceEvent((raw: unknown) => {
      const event = raw as VoiceEvent;

      switch (event.type) {
        case "voice:state":
          set({ sessionState: event.state, error: event.error ?? null });

          if (event.state === "listening") {
            if (!capture) {
              capture = new AudioCapture();
              void capture.start().catch((err) => {
                console.error("[voice] mic error:", err);
                set({ error: "Microphone access denied" });
                void bridge.stopVoice();
              });
            }
          } else if (event.state === "inactive" || event.state === "error") {
            capture?.stop();
            capture = null;
            playback?.interrupt();
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
          void playback?.enqueue(event.audio);
          break;
      }
    });

    void get().loadSettings();
    return () => {
      unsub();
      capture?.stop();
      capture = null;
      playback?.dispose();
      playback = null;
    };
  },

  toggleVoice: () => {
    const bridge = getBridge();
    if (!bridge) return;
    const { sessionState } = get();

    if (sessionState === "inactive") {
      void bridge.startVoice();
    } else if (sessionState === "speaking") {
      // Interrupt speech and restart listening
      capture?.stop();
      capture = null;
      playback?.interrupt();
      void bridge.stopVoice().then(() => bridge.startVoice());
    } else {
      capture?.stop();
      capture = null;
      playback?.interrupt();
      void bridge.stopVoice();
    }
  },

  loadSettings: async () => {
    const bridge = getBridge();
    if (!bridge) return;
    try {
      const { settings } = await bridge.getVoiceSettings();
      set({ isConfigured: settings !== null && settings.apiKeyMasked.length > 0 });
    } catch {
      // IPC unavailable — leave isConfigured as-is
    }
  },
}));
