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

const PROCESSING_TIMEOUT_MS = 30_000;

export class VoiceService {
  private state: VoiceSessionState = "inactive";
  private stt: ElevenLabsSTT | null = null;
  private tts: ElevenLabsTTS | null = null;
  private listeners = new Set<EventListener>();
  private settings: VoiceSettings | null = null;
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

    this.stt = new ElevenLabsSTT(this.settings.apiKey);
    this.stt.connect({
      onConnected: () => {
        console.log("[voice] STT connected, now listening");
        this.setState("listening");
      },
      onTranscript: (t) => {
        console.log(`[voice] transcript ${t.isFinal ? "(final)" : "(partial)"}:`, t.text);
        this.emit({ type: "voice:transcript", text: t.text, isFinal: t.isFinal });

        if (t.isFinal && t.text.trim()) {
          console.log("[voice] sending to agent:", t.text.trim());
          this.setState("processing");
          this.startProcessingTimeout();
          const agent = this.getAgent();
          if (agent) {
            void agent.sendMessage(t.text.trim());
          } else {
            console.warn("[voice] no agent available to handle transcript");
          }
        }
      },
      onError: (error) => {
        console.error("[voice] STT error:", error);
        this.setState("error", error);
      },
    });

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

  /** Called when the agent finishes an assistant response.
   *  Guards against race where voice is stopped between isActive() check and this call. */
  handleAgentResponse(text: string): void {
    console.log("[voice] agent response:", text.slice(0, 200), text.length > 200 ? "..." : "");
    if (this.state === "inactive" || this.state === "error") {
      console.log("[voice] ignoring response, state is", this.state);
      return;
    }
    if (!text.trim()) {
      console.log("[voice] empty response, back to listening");
      this.setState("listening");
      return;
    }
    if (!this.settings) {
      console.warn("[voice] no settings, cannot TTS");
      return;
    }

    // Interrupt any in-flight TTS before starting a new one
    this.tts?.interrupt();
    this.tts = null;

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
    console.log(`[voice] ${this.state} → ${state}${error ? ` (${error})` : ""}`);
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
