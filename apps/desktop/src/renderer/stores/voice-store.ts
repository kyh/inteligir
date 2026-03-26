import { Room } from "livekit-client";
import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import { bindAudio } from "@/renderer/voice/audio-binder";
import { VoiceSession } from "@/renderer/voice/session";
import type { VoiceSessionState } from "@/shared/voice";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type VoiceStore = {
  sessionState: VoiceSessionState;
  currentTranscript: string;
  error: string | null;

  // Callbacks — set by agent-store to break circular dependency
  onUserMessage: ((text: string) => void) | null;
  onSteerMessage: ((text: string) => void) | null;

  init: () => () => void;
  setCallbacks: (cbs: {
    onUserMessage: (text: string) => void;
    onSteerMessage: (text: string) => void;
  }) => void;
  /** Called by agent-store when the sidecar process crashes */
  handleSidecarError: (message: string) => void;
  /** Reset to initial state — called on logout */
  reset: () => void;
  toggleVoice: () => void;
  sendMessage: (text: string) => void;
  steer: (text: string) => void;
  interrupt: () => void;
  clearChat: () => void;
};

let session: VoiceSession | null = null;

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  sessionState: "inactive",
  currentTranscript: "",
  error: null,
  onUserMessage: null,
  onSteerMessage: null,

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};

    session = new VoiceSession({
      roomFactory: () => new Room(),
      tokenFetcher: () => bridge.getVoiceToken(),
    });

    // Subscribe to session events
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
          get().onUserMessage?.(event.text);
          break;
      }
    });

    // Bind audio tracks to DOM elements
    const unsubAudio = bindAudio(session);

    return () => {
      unsubSession();
      unsubAudio();
      session?.disconnect();
      session = null;
    };
  },

  setCallbacks: (cbs) => {
    set({ onUserMessage: cbs.onUserMessage, onSteerMessage: cbs.onSteerMessage });
  },

  toggleVoice: () => {
    if (!session) return;
    const { sessionState } = get();
    if (sessionState === "inactive" || sessionState === "error") {
      void session.connect();
    } else {
      session.disconnect();
    }
  },

  sendMessage: (text: string) => {
    if (session?.send({ type: "user_message", text })) {
      get().onUserMessage?.(text);
    }
  },

  steer: (text: string) => {
    if (session?.send({ type: "steer", text })) {
      get().onSteerMessage?.(text);
    }
  },

  interrupt: () => {
    session?.send({ type: "interrupt" });
  },

  clearChat: () => {
    session?.send({ type: "clear" });
  },

  handleSidecarError: (message: string) => {
    session?.disconnect();
    set({ sessionState: "error", error: message, currentTranscript: "" });
  },

  reset: () => {
    session?.disconnect();
    set({ sessionState: "inactive", currentTranscript: "", error: null });
  },
}));
