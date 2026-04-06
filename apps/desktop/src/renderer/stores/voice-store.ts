import { Room } from "livekit-client";
import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import { bindAudio } from "@/renderer/voice/audio-binder";
import { VoiceSession } from "@/renderer/voice/session";
import type { VoiceSessionState } from "@/shared/voice";

// ---------------------------------------------------------------------------
// Store — manages voice session lifecycle only.
// Text commands go through the agent store, not here.
// ---------------------------------------------------------------------------

type VoiceStore = {
  sessionState: VoiceSessionState;
  currentTranscript: string;
  error: string | null;

  init: () => () => void;
  handleSidecarError: (message: string) => void;
  reset: () => void;
  toggleVoice: () => void;
};

let session: VoiceSession | null = null;

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  sessionState: "inactive",
  currentTranscript: "",
  error: null,

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};

    session = new VoiceSession({
      roomFactory: () => new Room(),
      tokenFetcher: () => bridge.getVoiceToken(),
    });

    const unsubSession = session.on((event) => {
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
          // Voice transcripts are sent to the agent by the PiLLMAdapter on
          // the sidecar. We add the user message to the chat here so it
          // appears immediately. Import is deferred to avoid circular deps.
          if (event.text) {
            void import("@/renderer/stores/agent-store").then(({ useAgentStore }) => {
              useAgentStore.getState().addUserMessage(event.text);
            });
          }
          break;
      }
    });

    const unsubAudio = bindAudio(session);

    return () => {
      unsubSession();
      unsubAudio();
      session?.disconnect();
      session = null;
    };
  },

  toggleVoice: () => {
    if (!session) return;
    const { sessionState } = get();
    if (sessionState === "inactive" || sessionState === "error") {
      void session.connect();
    } else {
      session.disconnect();
      void getBridge()?.stopVoice();
    }
  },

  handleSidecarError: (message: string) => {
    session?.disconnect();
    void getBridge()?.stopVoice();
    set({ sessionState: "error", error: message, currentTranscript: "" });
  },

  reset: () => {
    session?.disconnect();
    void getBridge()?.stopVoice();
    set({ sessionState: "inactive", currentTranscript: "", error: null });
  },
}));
