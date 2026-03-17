// ---------------------------------------------------------------------------
// Microphone capture — getUserMedia + AudioWorkletNode → PCM base64
// ---------------------------------------------------------------------------

import { getBridge } from "@/renderer/lib/bridge";

const SAMPLE_RATE = 16000;

// AudioWorklet processor code, inlined as a blob URL to avoid extra files
const WORKLET_CODE = `
class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      this.port.postMessage(input[0]);
    }
    return true;
  }
}
registerProcessor("pcm-processor", PcmProcessor);
`;

export class AudioCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;

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

    // Load worklet from inline blob
    const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
    const workletUrl = URL.createObjectURL(blob);
    await this.context.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    const source = this.context.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.context, "pcm-processor");

    this.workletNode.port.addEventListener("message", (event) => {
      const float32 = event.data as Float32Array;
      const base64 = float32ToBase64Pcm16(float32);
      bridge.sendAudioChunk(base64);
    });
    this.workletNode.port.start();

    source.connect(this.workletNode);
    // Connect through a silent gain node to keep the graph alive without routing mic to speakers
    const silentGain = this.context.createGain();
    silentGain.gain.value = 0;
    this.workletNode.connect(silentGain);
    silentGain.connect(this.context.destination);
  }

  stop(): void {
    this.workletNode?.disconnect();
    this.workletNode = null;

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
