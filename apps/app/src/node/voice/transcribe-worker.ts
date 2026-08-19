// The transcription worker: one request, one answer, then exit.
//
// WHY A WORKER AT ALL. whisper.cpp decodes for 100 ms on a sentence and ~750 ms
// on a full minute, and the process it would otherwise run in owns
// better-sqlite3 (whose every call is synchronous) and the file watcher's fork
// channel. A native call that holds the loop for three quarters of a second
// stalls a save, a query and the watcher's liveness ping together.
//
// WHY ONE PER REQUEST rather than a warm pool. Opening the model measured
// 37–92 ms and the whole round trip 130–210 ms, against a 2 s budget — so the
// saving from keeping a context alive is imperceptible, while the cost is
// 185 MB resident for a feature used in bursts, plus an idle timer, a teardown
// step and a lifecycle the shutdown ladder would have to know about. The same
// trade `CLAUDE.md` records for the knowledge index's stat fingerprint.
//
// NOTHING HERE THROWS PAST THE MESSAGE. A native loader failing to dlopen is
// exactly the case the probe exists to report, so it must arrive as a sentence
// rather than as a worker `error` event carrying a stack.

import { parentPort, workerData } from "node:worker_threads";
import type { VoiceWorkerRequest, VoiceWorkerResponse } from "./worker-protocol";

const port = parentPort;
if (port === null) {
  throw new Error("transcribe-worker must be started as a worker thread");
}

function reply(response: VoiceWorkerResponse): void {
  port?.postMessage(response);
}

async function run(request: VoiceWorkerRequest): Promise<VoiceWorkerResponse> {
  // Imported HERE rather than at module scope so a binding that cannot load
  // answers the probe instead of killing the worker before it has a port.
  const { initWhisper } = await import("@fugood/whisper.node");
  if (request.kind === "probe") {
    return { kind: "probed" };
  }
  const context = await initWhisper({ filePath: request.modelPath, useGpu: true });
  try {
    // `language` and a zero temperature on purpose: dictation is one person
    // speaking English into a composer, and sampling makes the same audio
    // transcribe differently twice.
    const { promise } = context.transcribeData(request.pcm, {
      language: "en",
      temperature: 0,
    });
    const result = await promise;
    return { kind: "transcribed", text: result.result.trim() };
  } finally {
    await context.release();
  }
}

const request: VoiceWorkerRequest = workerData;
run(request).then(reply, (error: unknown) => {
  reply({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
});
