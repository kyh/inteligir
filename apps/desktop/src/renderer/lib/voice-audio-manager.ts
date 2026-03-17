// ---------------------------------------------------------------------------
// Manages audio capture + playback lifecycle for voice sessions.
// Keeps the voice store focused on pure state management.
// ---------------------------------------------------------------------------

import { AudioCapture } from "./audio-capture";
import { AudioPlaybackManager } from "./audio-playback";

export class VoiceAudioManager {
  private capture: AudioCapture | null = null;
  private playback: AudioPlaybackManager;

  constructor() {
    this.playback = new AudioPlaybackManager();
  }

  async startCapture(): Promise<void> {
    if (this.capture) return;
    this.capture = new AudioCapture();
    await this.capture.start();
  }

  stopCapture(): void {
    this.capture?.stop();
    this.capture = null;
  }

  async enqueueAudio(base64: string): Promise<void> {
    await this.playback.enqueue(base64);
  }

  interruptPlayback(): void {
    this.playback.interrupt();
  }

  dispose(): void {
    this.stopCapture();
    this.playback.dispose();
  }
}
