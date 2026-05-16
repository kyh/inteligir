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
  const maybeBridge = getBridge();
  if (!maybeBridge) throw new Error("Desktop bridge unavailable");
  // Capture in a const so TS narrowing survives into nested closures below.
  const bridge = maybeBridge;

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
  // Web Audio only invokes process() for nodes that have an unbroken path to
  // the AudioDestinationNode. A muted gain keeps the worklet running without
  // emitting any audible output.
  const silentSink = audioContext.createGain();
  silentSink.gain.value = 0;

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
  workletNode.connect(silentSink);
  silentSink.connect(audioContext.destination);

  /**
   * Ask the worklet to flush its partial buffer. Resolves after the flushed
   * chunk (if any) has crossed the message port and our onmessage handler
   * forwarded it to the main process — so the trailing ~128ms isn't dropped.
   */
  function flushWorklet(): Promise<void> {
    return new Promise<void>((resolveFlush) => {
      const port = workletNode.port;
      const prev = port.onmessage;
      port.onmessage = (event: MessageEvent<Float32Array | "flushed">) => {
        if (event.data === "flushed") {
          port.onmessage = prev;
          resolveFlush();
          return;
        }
        try {
          bridge.sendSttAudio(event.data.buffer as ArrayBuffer);
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        }
      };
      port.postMessage("flush");
    });
  }

  return {
    stop: () => {
      stopped = true;
      void flushWorklet()
        .then(() => bridge.stopStt())
        .then((tailEvents) => {
          for (const ev of tailEvents) {
            onTranscript(ev.text, ev.isFinal);
          }
        })
        .catch((err: unknown) => {
          onError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          workletNode.port.onmessage = null;
          workletNode.disconnect();
          silentSink.disconnect();
          sourceNode.disconnect();
          void audioContext.close();
          stream.getTracks().forEach((t) => t.stop());
          unsubscribe();
        });
    },
  };
}
