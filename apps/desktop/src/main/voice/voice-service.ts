// ---------------------------------------------------------------------------
// Voice service — orchestrates STT → agent → TTS pipeline
// ---------------------------------------------------------------------------

import type { Agent } from "@/main/agent/agent";
import type { VoiceEvent, VoiceSessionState, VoiceSettings } from "@/shared/voice";

import { ElevenLabsVoice } from "./elevenlabs-voice";
import { getVoiceSettings } from "./voice-settings-store";

type EventListener = (event: VoiceEvent) => void;

const PROCESSING_TIMEOUT_MS = 30_000;

export class VoiceService {
  private state: VoiceSessionState = "inactive";
  private voice: ElevenLabsVoice | null = null;
  private settings: VoiceSettings | null = null;
  private listeners = new Set<EventListener>();
  private processingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private getAgent: () => Agent | null,
  ) {}

  async start(): Promise<{ ok: boolean; error?: string }> {
    this.settings = getVoiceSettings();
    if (!this.settings) {
      return { ok: false, error: "Voice not configured — add API key in Settings" };
    }

    this.setState("starting");

    this.voice = new ElevenLabsVoice(this.settings.apiKey);
    this.voice.connectStt(this.settings.stt, {
      onConnected: () => {
        this.setState("listening");
      },
      onTranscript: (t) => {
        this.emit({ type: "voice:transcript", text: t.text, isFinal: t.isFinal });

        if (t.isFinal && t.text.trim()) {
          this.setState("processing");
          this.startProcessingTimeout();
          const agent = this.getAgent();
          if (agent) {
            void agent.sendMessage(t.text.trim());
          }
        }
      },
      onError: (error) => {
        this.setState("error", error);
      },
    });

    return { ok: true };
  }

  stop(): { ok: boolean } {
    this.voice?.dispose();
    this.voice = null;
    this.setState("inactive");
    return { ok: true };
  }

  sendAudio(base64Chunk: string): void {
    this.voice?.sendAudio(base64Chunk, this.settings?.stt.sampleRate ?? 16000);
  }

  /** Called when the agent finishes an assistant response.
   *  Guards against race where voice is stopped between isActive() check and this call. */
  handleAgentResponse(text: string): void {
    if (this.state === "inactive" || this.state === "error") return;
    if (!text.trim()) {
      this.setState("listening");
      return;
    }
    if (!this.settings || !this.voice) {
      this.clearProcessingTimeout();
      return;
    }

    // Interrupt any in-flight TTS before starting a new one
    this.voice.interruptTts();

    this.setState("speaking");

    this.voice.speak(this.settings.voiceId, text, {
      onAudioChunk: (audio) => {
        this.emit({ type: "voice:tts-chunk", audio });
      },
      onDone: () => {
        if (this.state === "speaking") {
          this.setState("listening");
        }
      },
      onError: (error) => {
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

  private startProcessingTimeout(): void {
    this.clearProcessingTimeout();
    this.processingTimer = setTimeout(() => {
      if (this.state === "processing") {
        this.setState("listening");
      }
    }, PROCESSING_TIMEOUT_MS);
  }

  private clearProcessingTimeout(): void {
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }
  }

  private setState(state: VoiceSessionState, error?: string): void {
    if (state !== "processing") this.clearProcessingTimeout();
    this.state = state;
    this.emit({ type: "voice:state", state, error });
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
