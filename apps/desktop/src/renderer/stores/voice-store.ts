import { Room, RoomEvent, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from "livekit-client";
import { create } from "zustand";

import { getBridge } from "@/renderer/lib/bridge";
import type { DesktopBridge } from "@/shared/ipc";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { toErrorMessage } from "@/shared/ipc";
import { TEXT_CHAT_TOPIC, type TextChatMessage, type VoiceSessionState } from "@/shared/voice";

const textEncoder = new TextEncoder();
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 2_000;

function sendDataMessage(msg: TextChatMessage): boolean {
  if (!room || room.state !== "connected") return false;
  const data = textEncoder.encode(JSON.stringify(msg));
  void room.localParticipant.publishData(data, { reliable: true, topic: TEXT_CHAT_TOPIC });
  return true;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type VoiceStore = {
  sessionState: VoiceSessionState;
  currentTranscript: string;
  error: string | null;

  init: () => () => void;
  toggleVoice: () => void;
  sendMessage: (text: string) => void;
  steer: (text: string) => void;
  interrupt: () => void;
  clearChat: () => void;
};

// Module-level room singleton — safe for single-window Electron app
let room: Room | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectAbortController: AbortController | null = null;

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  sessionState: "inactive",
  currentTranscript: "",
  error: null,

  // LiveKit voice connects on demand via toggleVoice — no eager init needed.
  init: () => () => {},

  toggleVoice: () => {
    const bridge = getBridge();
    if (!bridge) return;
    const { sessionState } = get();

    if (sessionState === "inactive" || sessionState === "error") {
      void connectToRoom(bridge, set);
    } else {
      disconnectRoom(set);
    }
  },

  sendMessage: (text: string) => {
    if (sendDataMessage({ type: "user_message", text })) {
      useAgentStore.getState().addUserMessage(text);
    }
  },

  steer: (text: string) => {
    if (sendDataMessage({ type: "steer", text })) {
      useAgentStore.getState().addSteerMessage(text);
    }
  },

  interrupt: () => {
    sendDataMessage({ type: "interrupt" });
  },

  clearChat: () => {
    sendDataMessage({ type: "clear" });
  },
}));

// ---------------------------------------------------------------------------
// Room connection lifecycle
// ---------------------------------------------------------------------------

type SetState = (partial: Partial<VoiceStore>) => void;

async function connectToRoom(
  bridge: DesktopBridge,
  set: SetState,
): Promise<void> {
  // Abort any previous in-flight connect attempt
  connectAbortController?.abort();
  const abort = new AbortController();
  connectAbortController = abort;

  set({ sessionState: "connecting", error: null });

  try {
    // Get LiveKit token (also ensures sidecar is running)
    const { url, token } = await bridge.getVoiceToken();
    if (abort.signal.aborted) return;

    // Create room and connect
    room = new Room();

    room.on(RoomEvent.Connected, () => {
      console.log("[voice] room connected, waiting for agent...");
    });

    room.on(RoomEvent.Disconnected, (reason) => {
      console.log("[voice] room disconnected:", reason);
      room = null;
      const state = useVoiceStore.getState().sessionState;
      // Skip if already inactive (e.g. explicit disconnectRoom call)
      if (state === "inactive") return;

      // Attempt reconnection with exponential backoff
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts);
        reconnectAttempts++;
        console.log(`[voice] reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        set({ sessionState: "connecting", error: null });
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void connectToRoom(bridge, set);
        }, delay);
      } else {
        reconnectAttempts = 0;
        set({
          sessionState: "error",
          currentTranscript: "",
          error: `Disconnected: ${String(reason ?? "unknown")}. Reconnect attempts exhausted.`,
        });
      }
    });

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      console.log("[voice] connection state:", state);
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      console.log("[voice] track subscribed:", track.kind, "from", participant.identity);
      if (track.kind === "audio") {
        // Remove stale element from previous connection before attaching
        document.getElementById("livekit-agent-audio")?.remove();
        const el = track.attach();
        el.id = "livekit-agent-audio";
        document.body.appendChild(el);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      console.log("[voice] track unsubscribed:", track.kind);
      if (track.kind === "audio") {
        for (const el of track.detach()) {
          el.remove();
        }
      }
    });

    room.on(RoomEvent.TrackPublished, (pub, participant) => {
      console.log("[voice] track published:", pub.kind, "by", participant.identity);
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log("[voice] participant connected:", participant.identity);
      // Agent joined — pipeline is ready. Reset reconnect counter on success.
      reconnectAttempts = 0;
      set({ sessionState: "connected" });
    });

    room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      console.log("[voice] transcription:", segments.map((s) => s.text).join(" "), "from", participant?.identity);
      // In LiveKit's agent pipeline, STT transcription is attributed to the
      // local participant (the user whose speech was transcribed). Agent TTS
      // transcription is attributed to the agent (remote) participant.
      // We only want user speech here — skip agent/remote transcriptions.
      if (participant?.identity !== room?.localParticipant.identity) return;
      for (const seg of segments) {
        if (seg.final) {
          set({ currentTranscript: "" });
          if (seg.text.trim()) {
            useAgentStore.getState().addUserMessage(seg.text.trim());
          }
        } else {
          set({ currentTranscript: seg.text });
        }
      }
    });

    console.log("[voice] connecting to", url);
    await room.connect(url, token);
    if (abort.signal.aborted) {
      void room.disconnect();
      room = null;
      return;
    }
    await room.localParticipant.setMicrophoneEnabled(true);
    console.log("[voice] mic enabled, local tracks:", room.localParticipant.audioTrackPublications.size);

    // If agent is already in the room (e.g. reconnect), mark as ready
    if (room.remoteParticipants.size > 0) {
      set({ sessionState: "connected" });
    }
  } catch (err) {
    set({
      sessionState: "error",
      error: toErrorMessage(err),
    });
    if (room) {
      void room.disconnect();
      room = null;
    }
  }
}

function disconnectRoom(set: SetState): void {
  connectAbortController?.abort();
  connectAbortController = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  document.getElementById("livekit-agent-audio")?.remove();
  if (room) {
    void room.disconnect();
    room = null;
  }
  set({ sessionState: "inactive", currentTranscript: "" });
}
