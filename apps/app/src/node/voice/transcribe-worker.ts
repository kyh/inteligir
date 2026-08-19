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
//
// THE PROBE ACTUALLY LOADS THE NATIVE BINDING. `import("@fugood/whisper.node")`
// alone loads only the pure-JS wrapper; the `.node` addon is dlopened lazily
// inside `loadModule` — reached by `loadWhisperModule()` and by `initWhisper`,
// never by the bare import. A probe that only imported would pass on a machine
// whose binary cannot load (no prebuild for the platform, an ABI mismatch, a
// macOS older than the binary's minimum — where dyld refuses at dlopen), and
// the failure would surface only on the user's first real dictation. So the
// probe calls `loadWhisperModule()` and forces the load.

import { parentPort, workerData } from "node:worker_threads";
import type { VoiceWorkerRequest, VoiceWorkerResponse } from "./worker-protocol";

const port = parentPort;
if (port === null) {
  throw new Error("transcribe-worker must be started as a worker thread");
}

function reply(response: VoiceWorkerResponse): void {
  port?.postMessage(response);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run(request: VoiceWorkerRequest): Promise<VoiceWorkerResponse> {
  const whisper = await import("@fugood/whisper.node");
  if (request.kind === "probe") {
    // Forces the dlopen (see the header); a binding that cannot load throws
    // here, which is exactly what the probe exists to catch.
    await whisper.loadWhisperModule();
    return { kind: "probed" };
  }

  // Split so a failure names its stage: a model that will not open is a fact
  // about the file on disk (nuke it), a decode that throws is about the clip.
  let context: Awaited<ReturnType<typeof whisper.initWhisper>>;
  try {
    context = await whisper.initWhisper({ filePath: request.modelPath, useGpu: true });
  } catch (error) {
    return { kind: "failed", message: message(error), modelUnusable: true };
  }
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
  } catch (error) {
    return { kind: "failed", message: message(error), modelUnusable: false };
  } finally {
    await context.release();
  }
}

const request: VoiceWorkerRequest = workerData;
run(request).then(reply, (error: unknown) => {
  // The only path here is the dynamic import itself throwing — a broken JS
  // wrapper — which is as unusable as a binding that will not load.
  reply({ kind: "failed", message: message(error), modelUnusable: true });
});
