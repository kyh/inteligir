// Running the transcription worker: resolve its entry, and either hand it one
// request and take one answer (a probe, a batch clip), or hold it open for the
// life of a dictation hold (the streaming session).
//
// THE ENTRY IS RESOLVED AS A SIBLING of the running module, the same walk
// `vault/watcher/fork-channel.ts` makes for the watcher child and for the same
// reason: in dev this module runs from source and its sibling is the `.ts`
// entry, in a build it is inside `dist-node/main.js` and the sibling is the
// separately-bundled `.mjs`. The two resolvers are deliberately not shared —
// `fork-channel.ts` is vendored; keep house helpers out of it.
//
// EVERY EXIT PATH TERMINATES THE WORKER. A native decode that wedges would
// otherwise hold a thread and the model's memory for the life of the process —
// so the one-shot path enforces a budget here, and the streaming handle's
// `dispose` (release / cancel / disconnect / app teardown) always terminates.
// A streaming worker that fails or exits before its final reports it through
// `onError` rather than escaping as an unhandled rejection.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type {
  VoiceModelFiles,
  VoiceStreamEvent,
  VoiceWorkerRequest,
  VoiceWorkerResponse,
} from "./worker-protocol";

/**
 * Generous against the work a ONE-SHOT bounds: the longest clip the contract
 * accepts is two minutes, which sherpa decodes in a few seconds, and a model
 * load is under a second. Anything near this budget is a wedged runtime, not a
 * slow one. The streaming session is NOT bounded by this — it is open for as
 * long as the user holds the mic and is torn down by its own `dispose`.
 */
const WORKER_BUDGET_MS = 60_000;

function resolveWorkerEntry(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    "transcribe-worker.mjs", // packaged: sibling of the node bundle
    "transcribe-worker.ts", // dev source
  ];
  for (const candidate of candidates) {
    const candidatePath = join(moduleDir, candidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  throw new Error(
    `Transcription worker entry not found in ${moduleDir} (looked for ${candidates.join(", ")})`,
  );
}

/**
 * Run one request to completion. Resolves with whatever the worker said —
 * including its `failed` answer, which is a refusal rather than an exception —
 * and rejects only when the worker never got to speak.
 */
export async function runVoiceWorker(request: VoiceWorkerRequest): Promise<VoiceWorkerResponse> {
  const worker = new Worker(resolveWorkerEntry(), {
    workerData: request,
    // The samples move rather than copy: the parent has no use for the buffer
    // once the worker holds it.
    transferList: request.kind === "transcribe" ? [request.pcm] : [],
  });

  // Four things race to answer — a message, an error, an early exit and the
  // budget — and only the FIRST of them may, which is the whole job of
  // `settled`. oxlint's promise/no-multiple-resolved cannot see that guard and
  // reads the several call sites of `settle` as several resolutions; there is
  // exactly one `resolve` in this function and it is reached at most once.
  const answer = await new Promise<VoiceWorkerResponse>((resolve) => {
    let settled = false;
    const settle = (response: VoiceWorkerResponse): void => {
      if (!settled) {
        settled = true;
        clearTimeout(budget);
        // oxlint-disable-next-line promise/no-multiple-resolved -- see above
        resolve(response);
      }
    };
    // These three are HOST-side failures — the worker never sent a message — so
    // `modelUnusable` is false: a timeout, a crash or an early exit could be a
    // wedged decode, an OOM or a segfault, none of which means the bytes on disk
    // are bad. The worker itself reports `modelUnusable: true` for the one case
    // that IS about the files (sherpa refusing to open the model).
    const budget = setTimeout(() => {
      settle({
        kind: "failed",
        message: "Transcription took too long and was stopped.",
        modelUnusable: false,
      });
    }, WORKER_BUDGET_MS);

    worker.on("message", (msg: VoiceWorkerResponse) => settle(msg));
    worker.on("error", (error: Error) =>
      settle({ kind: "failed", message: error.message, modelUnusable: false }),
    );
    worker.on("exit", () =>
      settle({
        kind: "failed",
        message: "The transcription worker stopped before answering.",
        modelUnusable: false,
      }),
    );
  });
  await worker.terminate();
  return answer;
}

export interface VoiceStreamWorkerCallbacks {
  onReady(): void;
  onPartial(text: string): void;
  onFinal(text: string): void;
  /** A refusal for a person, plus whether the MODEL is the fault (nuke it). */
  onError(message: string, modelUnusable: boolean): void;
}

export interface VoiceStreamWorkerHandle {
  /** A PCM16 chunk, transferred to the worker. */
  pushPcm(pcm: ArrayBuffer): void;
  /** Stop capturing and ask for the final. */
  finalize(): void;
  /** Terminate the worker. Idempotent — every exit path calls it. */
  dispose(): Promise<void>;
}

/**
 * Spawn a persistent streaming worker: load the model once, then feed it frames
 * and take partials/final. NEVER throws — a spawn failure is reported through
 * `onError` and a dead handle is returned, so no caller has to catch here and
 * no rejection escapes. Exactly one of `onFinal`/`onError` is delivered; after
 * it, further frames and finalizes are ignored.
 */
export function spawnVoiceStreamWorker(
  model: VoiceModelFiles,
  callbacks: VoiceStreamWorkerCallbacks,
): VoiceStreamWorkerHandle {
  let disposed = false;
  let settled = false;

  const fail = (reason: string, modelUnusable: boolean): void => {
    if (settled || disposed) {
      return;
    }
    settled = true;
    callbacks.onError(reason, modelUnusable);
  };

  let worker: Worker;
  try {
    worker = new Worker(resolveWorkerEntry(), { workerData: { kind: "stream", model } });
  } catch (error) {
    // A missing worker bundle is a packaging fault, not a corrupt model.
    callbacks.onError(error instanceof Error ? error.message : String(error), false);
    return { pushPcm: () => undefined, finalize: () => undefined, dispose: async () => undefined };
  }

  worker.on("message", (event: VoiceStreamEvent) => {
    switch (event.kind) {
      case "ready":
        callbacks.onReady();
        break;
      case "partial":
        if (!settled) {
          callbacks.onPartial(event.text);
        }
        break;
      case "final":
        if (!settled) {
          settled = true;
          callbacks.onFinal(event.text);
        }
        break;
      case "failed":
        fail(event.message, event.modelUnusable);
        break;
    }
  });
  worker.on("error", (error: Error) => fail(error.message, false));
  worker.on("exit", () => fail("The transcription worker stopped before answering.", false));

  return {
    pushPcm: (pcm) => {
      if (!disposed && !settled) {
        worker.postMessage({ kind: "audio", pcm }, [pcm]);
      }
    },
    finalize: () => {
      if (!disposed && !settled) {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- node worker_threads, not a browser window
        worker.postMessage({ kind: "finalize" });
      }
    },
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      await worker.terminate();
    },
  };
}
