// ---------------------------------------------------------------------------
// VoiceSession — testable core for voice lifecycle. No Zustand, no DOM.
// All state is instance-level. Accepts injectable Room + token fetcher.
// ---------------------------------------------------------------------------

import { Room, RoomEvent, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from "livekit-client";

import { toErrorMessage } from "@/shared/ipc";
import type { VoiceSessionEvent, VoiceSessionState } from "@/shared/voice";
import { DEFAULT_RECONNECT_POLICY, nextReconnectDelay, type ReconnectPolicy } from "./reconnect";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoomFactory = () => Room;
export type TokenFetcher = () => Promise<{ url: string; token: string }>;
export type VoiceSessionListener = (event: VoiceSessionEvent) => void;

export type VoiceSessionOptions = {
  roomFactory: RoomFactory;
  tokenFetcher: TokenFetcher;
  reconnectPolicy?: ReconnectPolicy;
};

// ---------------------------------------------------------------------------
// VoiceSession class
// ---------------------------------------------------------------------------

export class VoiceSession {
  private room: Room | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private sessionState: VoiceSessionState = "inactive";
  private readonly listeners = new Set<VoiceSessionListener>();
  private readonly policy: ReconnectPolicy;

  constructor(private readonly opts: VoiceSessionOptions) {
    this.policy = opts.reconnectPolicy ?? DEFAULT_RECONNECT_POLICY;
  }

  // ---- Subscription ---------------------------------------------------------

  on(listener: VoiceSessionListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getState(): VoiceSessionState {
    return this.sessionState;
  }

  // ---- Commands -------------------------------------------------------------

  async connect(): Promise<void> {
    // Abort any in-flight attempt
    this.abortController?.abort();
    const abort = new AbortController();
    this.abortController = abort;

    this.setSessionState("connecting");

    try {
      const { url, token } = await this.opts.tokenFetcher();
      if (abort.signal.aborted) return;

      const room = this.opts.roomFactory();
      this.room = room;

      this.attachRoomListeners(room, abort);

      console.log("[voice] connecting to", url);
      await room.connect(url, token);
      if (abort.signal.aborted) {
        void room.disconnect();
        this.room = null;
        return;
      }

      await room.localParticipant.setMicrophoneEnabled(true);
      console.log("[voice] mic enabled, local tracks:", room.localParticipant.audioTrackPublications.size);

      // If agent is already in the room (e.g. reconnect), mark as ready
      if (room.remoteParticipants.size > 0) {
        this.reconnectAttempts = 0;
        this.setSessionState("connected");
      }
    } catch (err) {
      this.setSessionState("error", toErrorMessage(err));
      if (this.room) {
        void this.room.disconnect();
        this.room = null;
      }
    }
  }

  disconnect(): void {
    this.abortController?.abort();
    this.abortController = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;

    if (this.room) {
      void this.room.disconnect();
      this.room = null;
    }

    this.setSessionState("inactive");
  }

  // ---- Internal -------------------------------------------------------------

  private emit(event: VoiceSessionEvent): void {
    for (const fn of this.listeners) {
      try { fn(event); } catch { /* listener error */ }
    }
  }

  private setSessionState(state: VoiceSessionState, error?: string): void {
    this.sessionState = state;
    this.emit({ type: "state_changed", state, error });
  }

  private attachRoomListeners(room: Room, _abort: AbortController): void {
    room.on(RoomEvent.Connected, () => {
      console.log("[voice] room connected, waiting for agent...");
    });

    room.on(RoomEvent.Disconnected, (reason) => {
      console.log("[voice] room disconnected:", reason);
      this.room = null;

      // Skip if already inactive (e.g. explicit disconnect call)
      if (this.sessionState === "inactive") return;

      this.scheduleReconnect(String(reason ?? "unknown"));
    });

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      console.log("[voice] connection state:", state);
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      console.log("[voice] track subscribed:", track.kind, "from", participant.identity);
      if (!this.room) return;
      if (track.kind === "audio") {
        this.emit({ type: "audio_track_subscribed", track });
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      console.log("[voice] track unsubscribed:", track.kind);
      if (track.kind === "audio") {
        this.emit({ type: "audio_track_unsubscribed", track });
      }
    });

    room.on(RoomEvent.TrackPublished, (pub, participant) => {
      console.log("[voice] track published:", pub.kind, "by", participant.identity);
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log("[voice] participant connected:", participant.identity);
      // Agent joined — pipeline is ready. Reset reconnect counter.
      this.reconnectAttempts = 0;
      this.setSessionState("connected");
    });

    room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      console.log("[voice] transcription:", segments.map((s) => s.text).join(" "), "from", participant?.identity);
      // Only user speech — skip agent/remote transcriptions
      if (participant?.identity !== room.localParticipant.identity) return;
      for (const seg of segments) {
        if (seg.final) {
          this.emit({ type: "transcript_partial", text: "" });
          if (seg.text.trim()) {
            this.emit({ type: "transcript_final", text: seg.text.trim() });
          }
        } else {
          this.emit({ type: "transcript_partial", text: seg.text });
        }
      }
    });
  }

  private scheduleReconnect(reason: string): void {
    const delay = nextReconnectDelay(this.reconnectAttempts, this.policy);

    if (delay === null) {
      this.reconnectAttempts = 0;
      this.setSessionState("error", `Disconnected: ${reason}. Reconnect attempts exhausted.`);
      return;
    }

    this.reconnectAttempts++;
    console.log(`[voice] reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.policy.maxAttempts})`);
    this.setSessionState("connecting");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
