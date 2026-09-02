// the status is read from disk, never cached: the model dir is shared across every checkout on
// this machine, so a second instance can install or delete under this one. the scripted service
// is a second implementation, not a pretend flag on the real one: a flag puts the branch inside
// the code the scenario tests.

import {
  VOICE_BYTES_PER_SAMPLE,
  VOICE_SAMPLE_RATE,
  type VoiceModel,
  type VoiceStatusResponse,
} from "@repo/api/local/voice/voice-schema";
import { VOICE_MODEL, type VoiceModelSpec } from "./model-catalog";
import {
  downloadModel,
  isModelInstalled,
  resolveModelFiles,
  ModelDownloadError,
  removeModel,
  type DownloadModelArgs,
} from "./model-store";
import {
  ScriptedStreamSession,
  WorkerStreamSession,
  type StreamHandlers,
  type StreamSession,
} from "./stream-session";
import { runVoiceWorker, spawnVoiceStreamWorker } from "./voice-worker-host";

export class VoiceUnavailableError extends Error {}
export class VoiceBusyError extends Error {}
export class VoiceTranscriptionError extends Error {}

export interface VoiceService {
  status(): Promise<VoiceStatusResponse>;
  install(): Promise<VoiceStatusResponse>;
  remove(): Promise<VoiceStatusResponse>;
  transcribe(pcm: ArrayBuffer): Promise<string>;
  createStreamSession(handlers: StreamHandlers): StreamSession;
  dispose(): Promise<void>;
}

// the digest and the url reach no client.
function wireModel(spec: VoiceModelSpec): VoiceModel {
  return { id: spec.id, label: spec.label, sizeBytes: spec.sizeBytes };
}

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
  #transcribing = false;
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
      return { state: "unavailable", detail: problem };
    }
    const download = this.#download;
    if (download !== null) {
      return {
        state: "downloading",
        model: wireModel(VOICE_MODEL),
        receivedBytes: download.receivedBytes,
      };
    }
    if (await isModelInstalled(this.#modelDir, VOICE_MODEL)) {
      return this.#preparing
        ? { state: "preparing", model: wireModel(VOICE_MODEL) }
        : { state: "ready", model: wireModel(VOICE_MODEL) };
    }
    return { state: "no-model", model: wireModel(VOICE_MODEL), lastError: this.#lastError };
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
          spec: VOICE_MODEL,
          signal: inFlight.controller.signal,
          onProgress: (receivedBytes) => {
            inFlight.receivedBytes = receivedBytes;
          },
        };
        if (this.#fetchImpl !== undefined) download.fetchImpl = this.#fetchImpl;
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
    return this.status();
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
    return this.status();
  }

  async transcribe(pcm: ArrayBuffer): Promise<string> {
    // claimed before any await: two dictations in one tick would both pass and spawn two workers.
    if (this.#preparing) {
      throw new VoiceBusyError("The speech model is still being prepared.");
    }
    if (this.#transcribing) {
      throw new VoiceBusyError("Another dictation is still being transcribed.");
    }
    this.#transcribing = true;
    try {
      const problem = await this.#probe();
      if (problem !== null) {
        throw new VoiceUnavailableError(problem);
      }
      if (!(await isModelInstalled(this.#modelDir, VOICE_MODEL))) {
        throw new VoiceUnavailableError(
          `Dictation needs the ${VOICE_MODEL.label} model. Turn on voice input in Settings to download it.`,
        );
      }
      const answer = await this.#runWorker({
        kind: "transcribe",
        model: resolveModelFiles(this.#modelDir, VOICE_MODEL),
        pcm,
      });
      if (answer.kind === "transcribed") {
        return answer.text;
      }
      if (answer.kind === "probed") {
        throw new VoiceTranscriptionError(
          "The transcription runtime answered a probe instead of a transcript.",
        );
      }
      await this.#recordWorkerFailure(answer.message, answer.modelUnusable);
      // a model that would not load is now gone, so this is unavailable, not a bad clip.
      throw answer.modelUnusable
        ? new VoiceUnavailableError(MODEL_REMOVED_MESSAGE)
        : new VoiceTranscriptionError(answer.message);
    } finally {
      this.#transcribing = false;
    }
  }

  createStreamSession(handlers: StreamHandlers): StreamSession {
    return new WorkerStreamSession({
      handlers,
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
        return { ok: true, model: resolveModelFiles(this.#modelDir, VOICE_MODEL) };
      },
      spawn: (model, callbacks) => this.#spawnStreamWorker(model, callbacks),
      onModelUnusable: async () => {
        await this.#recordWorkerFailure(MODEL_REMOVED_MESSAGE, true);
        return MODEL_REMOVED_MESSAGE;
      },
    });
  }

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

// the wire shape directly: there is no archive to pin, so a catalog spec would be fabricated.
const SCRIPTED_VOICE_MODEL: VoiceModel = {
  id: "scripted",
  label: "Scripted (test runtime)",
  sizeBytes: 1,
};

export class ScriptedVoiceService implements VoiceService {
  async status(): Promise<VoiceStatusResponse> {
    return { state: "ready", model: SCRIPTED_VOICE_MODEL };
  }

  async install(): Promise<VoiceStatusResponse> {
    return this.status();
  }

  async remove(): Promise<VoiceStatusResponse> {
    return this.status();
  }

  async transcribe(pcm: ArrayBuffer): Promise<string> {
    return `scripted dictation of ${pcm.byteLength / VOICE_BYTES_PER_SAMPLE} samples`;
  }

  createStreamSession(handlers: StreamHandlers): StreamSession {
    return new ScriptedStreamSession(handlers);
  }

  async dispose(): Promise<void> {
    // Nothing to stop.
  }
}
