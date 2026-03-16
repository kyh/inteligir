// ---------------------------------------------------------------------------
// Audio playback manager — queues and plays base64 mp3 chunks sequentially
// ---------------------------------------------------------------------------

export class AudioPlaybackManager {
  private context: AudioContext | null = null;
  private queue: AudioBuffer[] = [];
  private isPlaying = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private onStateChange: ((playing: boolean) => void) | null = null;

  constructor(opts?: { onStateChange?: (playing: boolean) => void }) {
    this.onStateChange = opts?.onStateChange ?? null;
  }

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
    if (this.isPlaying) {
      this.isPlaying = false;
      this.onStateChange?.(false);
    }
  }

  private playNext(): void {
    if (this.queue.length === 0) {
      if (this.isPlaying) {
        this.isPlaying = false;
        this.onStateChange?.(false);
      }
      return;
    }

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.onStateChange?.(true);
    }

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
