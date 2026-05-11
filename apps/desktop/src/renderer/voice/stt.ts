// ---------------------------------------------------------------------------
// Local STT — captures mic audio in the renderer, pushes 16kHz Float32 PCM
// chunks to the main process where sherpa-onnx + streaming Parakeet runs.
// ---------------------------------------------------------------------------

import { getBridge } from "@/renderer/lib/bridge";

export type TranscriptCallback = (text: string, isFinal: boolean) => void;

export type STTHandle = {
  stop: () => void;
};

export async function startSTT(
  onTranscript: TranscriptCallback,
  onError: (error: string) => void,
): Promise<STTHandle> {
  const bridge = getBridge();
  if (!bridge) throw new Error("Desktop bridge unavailable");

  const startResult = await bridge.startStt();
  if (!startResult.ok) {
    throw new Error(startResult.reason ?? "Failed to start STT");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const audioContext = new AudioContext({ sampleRate: 16000 });
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  const silentOutput = audioContext.createGain();
  silentOutput.gain.value = 0;

  let stopped = false;

  const unsubscribe = bridge.onSttTranscript((event) => {
    if (stopped) return;
    onTranscript(event.text, event.isFinal);
  });

  processorNode.onaudioprocess = (event) => {
    if (stopped) return;
    const float32 = event.inputBuffer.getChannelData(0);
    // Copy because the underlying buffer is reused across callbacks.
    const copy = new Float32Array(float32.length);
    copy.set(float32);
    try {
      bridge.sendSttAudio(copy.buffer);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  sourceNode.connect(processorNode);
  processorNode.connect(silentOutput);
  silentOutput.connect(audioContext.destination);

  return {
    stop: () => {
      stopped = true;
      unsubscribe();
      processorNode.disconnect();
      sourceNode.disconnect();
      void audioContext.close();
      stream.getTracks().forEach((t) => t.stop());
      void bridge.stopStt();
    },
  };
}
