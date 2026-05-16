// ---------------------------------------------------------------------------
// Local STT — captures mic audio in the renderer, pushes 16kHz Float32 PCM
// chunks to the main process where sherpa-onnx + streaming Parakeet runs.
// ---------------------------------------------------------------------------

import { getBridge } from "@/renderer/lib/bridge";
import sttWorkletUrl from "@/renderer/voice/stt-worklet.js?url";

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

  // Request mic permission BEFORE starting the main-process recognizer
  // session — if the user denies, there's no main-process state to leak.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  let startResult: Awaited<ReturnType<typeof bridge.startStt>>;
  try {
    startResult = await bridge.startStt();
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    throw err;
  }
  if (!startResult.ok) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(startResult.reason ?? "Failed to start STT");
  }

  const audioContext = new AudioContext({ sampleRate: 16000 });
  try {
    await audioContext.audioWorklet.addModule(sttWorkletUrl);
  } catch (err) {
    void audioContext.close();
    stream.getTracks().forEach((t) => t.stop());
    void bridge.stopStt();
    throw err;
  }

  const sourceNode = audioContext.createMediaStreamSource(stream);
  const workletNode = new AudioWorkletNode(audioContext, "stt-processor");

  let stopped = false;

  const unsubscribe = bridge.onSttTranscript((event) => {
    if (stopped) return;
    onTranscript(event.text, event.isFinal);
  });

  workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (stopped) return;
    try {
      // Worklet posts a fresh Float32Array (slice()'d in the worklet) so the
      // backing buffer is always a plain ArrayBuffer, never SharedArrayBuffer.
      bridge.sendSttAudio(event.data.buffer as ArrayBuffer);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  sourceNode.connect(workletNode);

  return {
    stop: () => {
      stopped = true;
      workletNode.port.onmessage = null;
      workletNode.disconnect();
      sourceNode.disconnect();
      void audioContext.close();
      stream.getTracks().forEach((t) => t.stop());
      // stopStt returns the flushed tail transcript directly (not via the
      // broadcast channel) so it can't race the listener teardown below.
      // .finally(unsubscribe) so a rejection (e.g. native stopSession throws)
      // doesn't leave the IPC listener attached or surface as unhandled.
      bridge
        .stopStt()
        .then((tailEvents) => {
          for (const ev of tailEvents) {
            onTranscript(ev.text, ev.isFinal);
          }
        })
        .catch((err: unknown) => {
          onError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          unsubscribe();
        });
    },
  };
}
