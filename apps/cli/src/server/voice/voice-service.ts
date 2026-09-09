// the status is read from disk, never cached: the model dir is shared across every checkout on
// this machine, so a second instance can install or delete under this one. the scripted service
// (scripted-voice-service.ts) is a second implementation, not a pretend flag on this one: a flag
// puts the branch inside the code the scenario tests.

import { VOICE_BYTES_PER_SAMPLE, VOICE_SAMPLE_RATE } from "@repo/api/local/voice/voice-schema";
import type { VoiceModel, VoiceStatusResponse } from "@repo/api/local/voice/voice-schema";
import { VOICE_MODEL } from "./model-catalog";
import type { VoiceModelSpec } from "./model-catalog";
import {
  downloadModel,
  isModelInstalled,
  resolveModelFiles,
  ModelDownloadError,
  removeModel,
} from "./model-store";
import type { DownloadModelArgs } from "./model-store";
import { WorkerStreamSession } from "./stream-session";
import type { StreamHandlers, StreamSession } from "./stream-session";
import { VoiceBusyError, VoiceUnavailableError } from "./voice-errors";
import { runVoiceWorker, spawnVoiceStreamWorker } from "./voice-worker-host";

export interface VoiceService {
  status: () => Promise<VoiceStatusResponse>;
  install: () => Promise<VoiceStatusResponse>;
  remove: () => Promise<VoiceStatusResponse>;
  createStreamSession: (handlers: StreamHandlers) => StreamSession;
  dispose: () => Promise<void>;
}

// the digest and the url reach no client.
const wireModel = (spec: VoiceModelSpec): VoiceModel => ({
  id: spec.id,
  label: spec.label,
  sizeBytes: spec.sizeBytes,
});

interface DownloadInFlight {
  controller: AbortController;
  receivedBytes: number;
}

const WARM_UP_PCM_BYTES = VOICE_SAMPLE_RATE * VOICE_BYTES_PER_SAMPLE;

const MODEL_REMOVED_MESSAGE = `The ${VOICE_MODEL.label} model could not be loaded and was removed. Turn voice input on again in Settings to re-download it.`;

export interface ParakeetVoiceServiceArgs {
  modelDir: string;
  fetchImpl?: typeof fetch;
  runWorker?: typeof runVoiceWorker;
  spawnStreamWorker?: typeof spawnVoiceStreamWorker;
}

export class ParakeetVoiceService implements VoiceService {
  readonly #modelDir: string;
  readonly #fetchImpl: typeof fetch | undefined;
  readonly #runWorker: typeof runVoiceWorker;
  readonly #spawnStreamWorker: typeof spawnVoiceStreamWorker;
  #download: DownloadInFlight | null = null;
  #lastError: string | null = null;
  #preparing = false;
  #disposed = false;
  // kept for the process: whether a native binding loads cannot change under us.
  #runtimeProblem: string | null | undefined = undefined;

  constructor(args: ParakeetVoiceServiceArgs) {
    this.#modelDir = args.modelDir;
    this.#fetchImpl = args.fetchImpl;
    this.#runWorker = args.runWorker ?? runVoiceWorker;
    this.#spawnStreamWorker = args.spawnStreamWorker ?? spawnVoiceStreamWorker;
  }

  async #probe(): Promise<string | null> {
    if (this.#runtimeProblem !== undefined) {
      return this.#runtimeProblem;
    }
    const answer = await this.#runWorker({ kind: "probe" });
    this.#runtimeProblem =
      answer.kind === "failed" ? `Dictation cannot run on this machine: ${answer.message}` : null;
    return this.#runtimeProblem;
  }

  async status(): Promise<VoiceStatusResponse> {
    const problem = await this.#probe();
    if (problem !== null) {
      return { detail: problem, state: "unavailable" };
    }
    const download = this.#download;
    if (download !== null) {
      return {
        model: wireModel(VOICE_MODEL),
        receivedBytes: download.receivedBytes,
        state: "downloading",
      };
    }
    if (await isModelInstalled(this.#modelDir, VOICE_MODEL)) {
      return this.#preparing
        ? { model: wireModel(VOICE_MODEL), state: "preparing" }
        : { model: wireModel(VOICE_MODEL), state: "ready" };
    }
    return { lastError: this.#lastError, model: wireModel(VOICE_MODEL), state: "no-model" };
  }

  async install(): Promise<VoiceStatusResponse> {
    // claimed before any await: two installs in one tick would both pass and start two downloads.
    if (this.#download !== null) {
      throw new VoiceBusyError("The model is already downloading.");
    }
    const inFlight: DownloadInFlight = { controller: new AbortController(), receivedBytes: 0 };
    this.#download = inFlight;
    try {
      const problem = await this.#probe();
      if (problem !== null) {
        throw new VoiceUnavailableError(problem);
      }
      if (await isModelInstalled(this.#modelDir, VOICE_MODEL)) {
        throw new VoiceBusyError("The model is already installed.");
      }
    } catch (error) {
      // only this call's own claim: a remove racing the checks already cleared it.
      if (this.#download === inFlight) {
        this.#download = null;
      }
      throw error;
    }
    this.#lastError = null;
    // not awaited: a 100 MB fetch outlives any request timeout; the surface polls receivedBytes.
    void (async () => {
      try {
        const download: DownloadModelArgs = {
          modelDir: this.#modelDir,
          onProgress: (receivedBytes) => {
            inFlight.receivedBytes = receivedBytes;
          },
          signal: inFlight.controller.signal,
          spec: VOICE_MODEL,
        };
        if (this.#fetchImpl !== undefined) {
          download.fetchImpl = this.#fetchImpl;
        }
        await downloadModel(download);
        // only if this download is still current: a remove racing it already cleared it.
        if (this.#download === inFlight) {
          this.#download = null;
          this.#warmUp();
        }
      } catch (error) {
        if (this.#download === inFlight) {
          this.#download = null;
          this.#lastError =
            error instanceof ModelDownloadError || error instanceof Error
              ? error.message
              : String(error);
        }
      }
    })();
    return await this.status();
  }

  // a second of silence, so the graph load and any open failure land at the install the user
  // is watching rather than at their first dictation.
  #warmUp(): void {
    this.#preparing = true;
    void (async () => {
      try {
        const answer = await this.#runWorker({
          kind: "transcribe",
          model: resolveModelFiles(this.#modelDir, VOICE_MODEL),
          pcm: new ArrayBuffer(WARM_UP_PCM_BYTES),
        });
        if (answer.kind === "failed") {
          await this.#recordWorkerFailure(answer.message, answer.modelUnusable);
        }
      } catch (error) {
        // a warm-up that throws records like a failed answer rather than escaping this void.
        this.#lastError = error instanceof Error ? error.message : String(error);
      } finally {
        this.#preparing = false;
      }
    })();
  }

  // a model that will not load is corrupt for this build; a decode failure keeps the file.
  async #recordWorkerFailure(reason: string, modelUnusable: boolean): Promise<void> {
    this.#lastError = reason;
    if (modelUnusable) {
      await removeModel(this.#modelDir, VOICE_MODEL);
    }
  }

  async remove(): Promise<VoiceStatusResponse> {
    this.#download?.controller.abort();
    this.#download = null;
    this.#lastError = null;
    await removeModel(this.#modelDir, VOICE_MODEL);
    return await this.status();
  }

  createStreamSession(handlers: StreamHandlers): StreamSession {
    return new WorkerStreamSession({
      handlers,
      onModelUnusable: async () => {
        await this.#recordWorkerFailure(MODEL_REMOVED_MESSAGE, true);
        return MODEL_REMOVED_MESSAGE;
      },
      prepare: async () => {
        const problem = await this.#probe();
        if (problem !== null) {
          return { ok: false, reason: problem };
        }
        if (this.#preparing) {
          return { ok: false, reason: "The speech model is still being prepared." };
        }
        if (!(await isModelInstalled(this.#modelDir, VOICE_MODEL))) {
          return {
            ok: false,
            reason: `Dictation needs the ${VOICE_MODEL.label} model. Turn on voice input in Settings to download it.`,
          };
        }
        return { model: resolveModelFiles(this.#modelDir, VOICE_MODEL), ok: true };
      },
      spawn: (model, callbacks) => this.#spawnStreamWorker(model, callbacks),
    });
  }

  // oxlint-disable-next-line require-await -- the contract is a promise; the abort is synchronous.
  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    // a download left running past shutdown lands a partial file after the process said it stopped.
    this.#download?.controller.abort();
    this.#download = null;
  }
}
