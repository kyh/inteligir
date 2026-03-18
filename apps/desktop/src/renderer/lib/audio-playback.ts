// ---------------------------------------------------------------------------
// Audio playback manager — queues and plays base64 mp3 chunks sequentially
// Reuses a single AudioContext to avoid resource leaks.
// ---------------------------------------------------------------------------

export class AudioPlaybackManager {
  private context: AudioContext | null = null;
  private queue: AudioBuffer[] = [];
  private isPlaying = false;
  private currentSource: AudioBufferSourceNode | null = null;

  async enqueue(base64Audio: string): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
    }

    const raw = Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0));
    try {
      const buffer = await this.context.decodeAudioData(raw.buffer.slice(0));
      this.queue.push(buffer);
      if (!this.isPlaying) {
        this.playNext();
      }
    } catch {
      // Skip invalid audio chunks
    }
  }

  interrupt(): void {
    this.currentSource?.stop();
    this.currentSource = null;
    this.queue = [];
    this.isPlaying = false;
  }

  /** Close the AudioContext and release all resources. */
  dispose(): void {
    this.interrupt();
    if (this.context) {
      void this.context.close();
      this.context = null;
    }
  }

  private playNext(): void {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;

    const ctx = this.context!;
    // Resume AudioContext if suspended (Chromium suspends until user gesture)
    if (ctx.state === "suspended") {
      void ctx.resume().then(() => this.startSource());
    } else {
      this.startSource();
    }
  }

  private startSource(): void {
    const buffer = this.queue.shift()!;
    const source = this.context!.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context!.destination);
    source.addEventListener("ended", () => {
      this.currentSource = null;
      this.playNext();
    });
    this.currentSource = source;
    source.start();
  }
}
