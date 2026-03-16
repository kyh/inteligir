// ---------------------------------------------------------------------------
// Voice service — orchestrates STT → agent → TTS pipeline
// ---------------------------------------------------------------------------

import type { Agent } from "@/main/agent/agent";
import type { VoiceEvent, VoiceSessionState, VoiceSettings } from "@/shared/voice";

import { ElevenLabsSTT } from "./elevenlabs-stt";
import { ElevenLabsTTS } from "./elevenlabs-tts";
import { getVoiceSettings } from "./voice-settings-store";

export type VoiceTranscriptCallback = (t: { text: string; isFinal: boolean }) => void;

type EventListener = (event: VoiceEvent) => void;

export class VoiceService {
  private state: VoiceSessionState = "inactive";
  private stt: ElevenLabsSTT | null = null;
  private tts: ElevenLabsTTS | null = null;
  private listeners = new Set<EventListener>();
  private settings: VoiceSettings | null = null;

  constructor(
    private getAgent: () => Agent | null,
  ) {}

  async start(): Promise<{ ok: boolean; error?: string }> {
    this.settings = getVoiceSettings();
    if (!this.settings) {
      return { ok: false, error: "Voice not configured — add API key in Settings" };
    }

    this.setState("starting");

    this.stt = new ElevenLabsSTT(this.settings.apiKey);
    this.stt.connect({
      onTranscript: (t) => {
        this.emit({ type: "voice:transcript", text: t.text, isFinal: t.isFinal });

        if (t.isFinal && t.text.trim()) {
          this.setState("processing");
          const agent = this.getAgent();
          if (agent) {
            void agent.sendMessage(t.text.trim());
          }
        }
      },
      onError: (error) => {
        this.setState("error");
        this.emit({ type: "voice:state", state: "error", error });
      },
    });

    this.setState("listening");
    return { ok: true };
  }

  stop(): { ok: boolean } {
    this.stt?.close();
    this.stt = null;
    this.tts?.interrupt();
    this.tts = null;
    this.setState("inactive");
    return { ok: true };
  }

  sendAudio(base64Chunk: string): void {
    this.stt?.sendAudio(base64Chunk);
  }

  interruptTts(): { ok: boolean } {
    this.tts?.interrupt();
    this.tts = null;
    this.emit({ type: "voice:tts-done" });
    if (this.state === "speaking") {
      this.setState("listening");
    }
    return { ok: true };
  }

  /** Called when the agent finishes an assistant response */
  handleAgentResponse(text: string): void {
    if (this.state === "inactive") return;
    if (!text.trim()) {
      this.setState("listening");
      return;
    }
    if (!this.settings) return;

    this.setState("speaking");

    this.tts = new ElevenLabsTTS(this.settings.apiKey, this.settings.voiceId);
    this.tts.speak(text, {
      onAudioChunk: (audio) => {
        this.emit({ type: "voice:tts-chunk", audio });
      },
      onDone: () => {
        this.tts = null;
        this.emit({ type: "voice:tts-done" });
        if (this.state === "speaking") {
          this.setState("listening");
        }
      },
      onError: (error) => {
        this.tts = null;
        console.error("[voice] TTS error:", error);
        this.setState("listening");
      },
    });
  }

  isActive(): boolean {
    return this.state !== "inactive";
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(state: VoiceSessionState): void {
    this.state = state;
    this.emit({ type: "voice:state", state });
  }

  private emit(event: VoiceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* ignore */
      }
    }
  }
}
