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
    // slice() copies because the source buffer is reused across callbacks.
    const copy = float32.slice();
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
      processorNode.disconnect();
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
