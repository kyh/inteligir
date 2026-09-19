// the entry walk duplicates vault/watcher/fork-channel.ts's on purpose: that file is vendored,
// so house helpers stay out of it.

import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type {
  VoiceModelFiles,
  VoiceStreamEvent,
  VoiceStreamInit,
  VoiceWorkerRequest,
  VoiceWorkerResponse,
} from "./worker-protocol";

// a one-shot's work is bounded (two minutes of audio decodes in seconds, a load is under a
// second), so anything near this is a wedged runtime. the streaming session is not bounded by it.
const WORKER_BUDGET_MS = 60_000;

const resolveWorkerEntry = (): string => {
  const moduleDir = import.meta.dirname;
  // packaged: the .mjs sits beside the node bundle; dev: the .ts source.
  const candidates = ["transcribe-worker.mjs", "transcribe-worker.ts"];
  for (const candidate of candidates) {
    const candidatePath = path.join(moduleDir, candidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  throw new Error(
    `Transcription worker entry not found in ${moduleDir} (looked for ${candidates.join(", ")})`,
  );
};

export const runVoiceWorker = async (request: VoiceWorkerRequest): Promise<VoiceWorkerResponse> => {
  const worker = new Worker(resolveWorkerEntry(), {
    // transferred, not copied: the parent has no use for the buffer once the worker holds it.
    transferList: request.kind === "transcribe" ? [request.pcm] : [],
    workerData: request,
  });

  // four things race to answer (message, error, exit, budget); settled lets only the first through.
  // oxlint-disable-next-line promise/avoid-new -- racing three event listeners against a timer has no promise-native form.
  const answer = await new Promise<VoiceWorkerResponse>((resolve) => {
    let settled = false;
    let budget: ReturnType<typeof setTimeout> | null = null;
    const settle = (response: VoiceWorkerResponse): void => {
      if (!settled) {
        settled = true;
        if (budget !== null) {
          clearTimeout(budget);
        }
        resolve(response);
      }
    };
    // host-side failures (timeout, crash, early exit) say nothing about the bytes on disk, so
    // modelUnusable is false; only the worker's own answer can say otherwise.
    budget = setTimeout(() => {
      settle({
        kind: "failed",
        message: "Transcription took too long and was stopped.",
        modelUnusable: false,
      });
    }, WORKER_BUDGET_MS);

    worker.on("message", (msg: VoiceWorkerResponse) => {
      settle(msg);
    });
    worker.on("error", (error: Error) => {
      settle({ kind: "failed", message: error.message, modelUnusable: false });
    });
    worker.on("exit", () => {
      settle({
        kind: "failed",
        message: "The transcription worker stopped before answering.",
        modelUnusable: false,
      });
    });
  });
  await worker.terminate();
  return answer;
};

export interface VoiceStreamWorkerCallbacks {
  onReady: () => void;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string, modelUnusable: boolean) => void;
}

export interface VoiceStreamWorkerHandle {
  pushPcm: (pcm: ArrayBuffer) => void;
  finalize: () => void;
  // a handle that stops synchronously is a handle; every caller awaits either.
  dispose: () => void | Promise<void>;
}

// nothing spawned: every call is a no-op.
const DEAD_HANDLE: VoiceStreamWorkerHandle = {
  dispose: () => {
    // no worker
  },
  finalize: () => {
    // no worker
  },
  pushPcm: () => {
    // no worker
  },
};

// never throws: a spawn failure is reported through onError with a dead handle. exactly one of
// onFinal/onError is delivered.
export const spawnVoiceStreamWorker = (
  model: VoiceModelFiles,
  callbacks: VoiceStreamWorkerCallbacks,
): VoiceStreamWorkerHandle => {
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
    // workerData is any: an unannotated literal with a mistyped kind falls through to the
    // one-shot path and answers modelUnusable, which nukes the model cache.
    const init: VoiceStreamInit = { kind: "stream", model };
    worker = new Worker(resolveWorkerEntry(), { workerData: init });
  } catch (error) {
    // a missing worker bundle is a packaging fault, not a corrupt model.
    callbacks.onError(error instanceof Error ? error.message : String(error), false);
    return DEAD_HANDLE;
  }

  worker.on("message", (event: VoiceStreamEvent) => {
    switch (event.kind) {
      case "ready": {
        callbacks.onReady();
        break;
      }
      case "partial": {
        if (!settled) {
          callbacks.onPartial(event.text);
        }
        break;
      }
      case "final": {
        if (!settled) {
          settled = true;
          callbacks.onFinal(event.text);
        }
        break;
      }
      case "failed": {
        fail(event.message, event.modelUnusable);
        break;
      }
      // no default
    }
  });
  worker.on("error", (error: Error) => {
    fail(error.message, false);
  });
  worker.on("exit", () => {
    fail("The transcription worker stopped before answering.", false);
  });

  return {
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      await worker.terminate();
    },
    finalize: () => {
      if (!disposed && !settled) {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- node worker_threads, not a browser window
        worker.postMessage({ kind: "finalize" });
      }
    },
    pushPcm: (pcm) => {
      if (!disposed && !settled) {
        worker.postMessage({ kind: "audio", pcm }, [pcm]);
      }
    },
  };
};
