// Running the transcription worker: resolve its entry, hand it one request,
// take one answer, make sure it is gone.
//
// THE ENTRY IS RESOLVED AS A SIBLING of the running module, the same walk
// `vault/watcher/fork-channel.ts` makes for the watcher child and for the same
// reason: in dev this module runs from source and its sibling is the `.ts`
// entry, in a build it is inside `dist-node/main.js` and the sibling is the
// separately-bundled `.mjs`. The two resolvers are deliberately not shared —
// `fork-channel.ts` is vendored, and folding a house helper into it would make
// its provenance row a lie for the sake of fifteen lines.
//
// EVERY EXIT PATH TERMINATES THE WORKER. A native decode that wedges would
// otherwise hold a thread, its Metal command queue and the model's memory for
// the life of the process, and the request that started it would never
// answer — so the budget is enforced here rather than hoped for.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { VoiceWorkerRequest, VoiceWorkerResponse } from "./worker-protocol";

/**
 * Generous against the work it bounds: the longest clip the contract accepts
 * is two minutes, which measured about one second of decode, and a model load
 * is under a tenth of that. Anything near this budget is a wedged runtime, not
 * a slow one.
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
    // The samples move rather than copy: a two-minute clip is ~3.8 MB, and the
    // parent has no use for the buffer once the worker holds it.
    transferList: request.kind === "transcribe" ? [request.pcm] : [],
  });

  // Four things race to answer — a message, an error, an early exit and the
  // budget — and only the FIRST of them may, which is the whole job of
  // `settled`. oxlint's promise/no-multiple-resolved cannot see that guard and
  // reads the several call sites of `settle` as several resolutions; there is
  // exactly one `resolve` in this function and it is reached at most once.
  //
  // The terminate is deliberately outside the executor: it is teardown, it runs
  // on every path including the ones that already answered, and awaiting it
  // here is what makes "the thread is gone before this function returns" true
  // rather than hoped for.
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
    // These three are HOST-side failures — the worker never sent a message —
    // so `modelUnusable` is false: a timeout, a crash or an early exit could be
    // a wedged decode, an OOM or a segfault, none of which means the bytes on
    // disk are bad. The worker itself reports `modelUnusable: true` for the one
    // case that IS about the file (whisper.cpp refusing to open the model),
    // before it would ever reach one of these.
    const budget = setTimeout(() => {
      settle({
        kind: "failed",
        message: "Transcription took too long and was stopped.",
        modelUnusable: false,
      });
    }, WORKER_BUDGET_MS);

    worker.on("message", (message: VoiceWorkerResponse) => settle(message));
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
