// ---------------------------------------------------------------------------
// Microphone capture — getUserMedia + ScriptProcessorNode → PCM base64
// ---------------------------------------------------------------------------

import { getBridge } from "@/renderer/lib/bridge";

const SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;

export class AudioCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;

  async start(): Promise<void> {
    const bridge = getBridge();
    if (!bridge) throw new Error("Bridge not available");

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const source = this.context.createMediaStreamSource(this.stream);

    // Use ScriptProcessorNode for wide compatibility in Electron
    this.processor = this.context.createScriptProcessor(BUFFER_SIZE, 1, 1);
    this.processor.onaudioprocess = (event) => {
      const float32 = event.inputBuffer.getChannelData(0);
      const base64 = float32ToBase64Pcm16(float32);
      bridge.sendAudioChunk(base64);
    };

    source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  stop(): void {
    this.processor?.disconnect();
    this.processor = null;

    if (this.context) {
      void this.context.close();
      this.context = null;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }
}

function float32ToBase64Pcm16(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]!));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
