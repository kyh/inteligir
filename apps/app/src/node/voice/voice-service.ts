// Dictation, server-side: what this machine can do, how the model gets here,
// and one clip in / one sentence out.
//
// TWO IMPLEMENTATIONS OF ONE INTERFACE, not one implementation with a flag.
// The scripted service exists so a scenario can drive the WHOLE path — mic
// permission, capture, the wire, the composer insertion — on a machine with no
// model and no native binding; giving the real service a "pretend" mode would
// have put that branch inside the code the scenario is meant to be testing,
// and would have made `no-model` a state the fake can be in, which it cannot.
//
// THE STATUS IS READ FROM DISK, NEVER CACHED, because the model directory is
// shared across every checkout on this machine (see `AppConfig.modelDir`) and
// a second instance can install or delete under this one. The one thing held
// in memory is the download in flight, which is this process's own fact.

import {
  VOICE_BYTES_PER_SAMPLE,
  VOICE_SAMPLE_RATE,
  type VoiceModel,
  type VoiceStatusResponse,
} from "@repo/server-contract/voice";
import { SCRIPTED_VOICE_MODEL, VOICE_MODEL, type VoiceModelSpec } from "./model-catalog";
import {
  downloadModel,
  isModelInstalled,
  modelFilePath,
  ModelDownloadError,
  removeModel,
  type DownloadModelArgs,
} from "./model-store";
import { runVoiceWorker } from "./voice-worker-host";

/** No usable transcription runtime, or no model to run. */
export class VoiceUnavailableError extends Error {}
/** Something is already using it — a download or a transcription in flight. */
export class VoiceBusyError extends Error {}
/** The runtime loaded and refused this clip. */
export class VoiceTranscriptionError extends Error {}

export interface VoiceService {
  status(): Promise<VoiceStatusResponse>;
  install(): Promise<VoiceStatusResponse>;
  remove(): Promise<VoiceStatusResponse>;
  /** The clip's samples; the caller owns validating that they are in range. */
  transcribe(pcm: ArrayBuffer): Promise<string>;
  dispose(): Promise<void>;
}

/** The catalog entry as the wire carries it — the digest and the URL are this
 *  server's business and reach no client. */
function wireModel(spec: VoiceModelSpec): VoiceModel {
  return { id: spec.id, label: spec.label, sizeBytes: spec.sizeBytes };
}

interface DownloadInFlight {
  controller: AbortController;
  receivedBytes: number;
}

/**
 * A second of silence, transcribed once after a download so the GPU shader
 * library compiles inside the install rather than inside the user's first
 * dictation. Measured on an M1 Max: `ggml_metal_library_init` takes 9.865 s
 * the first time a machine runs this binary and 0.012 s on every run after,
 * across process restarts — so this is a one-off, and the only question is
 * which affordance is on screen while it happens.
 */
const WARM_UP_PCM_BYTES = VOICE_SAMPLE_RATE * VOICE_BYTES_PER_SAMPLE;

export interface WhisperVoiceServiceArgs {
  modelDir: string;
  /** Tests inject a transport rather than reaching the model's host. */
  fetchImpl?: typeof fetch;
  /**
   * Tests drive the refusal paths without spawning a thread. Injected rather
   * than mocked at the module boundary because the real runner dlopens a
   * native binding, which would make every one of these assertions a claim
   * about the platform the suite happens to be running on.
   */
  runWorker?: typeof runVoiceWorker;
}

export class WhisperVoiceService implements VoiceService {
  readonly #modelDir: string;
  readonly #fetchImpl: typeof fetch | undefined;
  readonly #runWorker: typeof runVoiceWorker;
  #download: DownloadInFlight | null = null;
  /** Why the last install stopped, so `no-model` can say it. Cleared by the
   *  next install and by `remove`, because both make it stale. */
  #lastError: string | null = null;
  #preparing = false;
  #transcribing = false;
  #disposed = false;
  /** The probe's answer, kept for the process: whether a native binding loads
   *  is a property of this build on this machine and cannot change under us. */
  #runtimeProblem: string | null | undefined = undefined;

  constructor(args: WhisperVoiceServiceArgs) {
    this.#modelDir = args.modelDir;
    this.#fetchImpl = args.fetchImpl;
    this.#runWorker = args.runWorker ?? runVoiceWorker;
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
    const problem = await this.#probe();
    if (problem !== null) {
      throw new VoiceUnavailableError(problem);
    }
    if (this.#download !== null) {
      throw new VoiceBusyError("The model is already downloading.");
    }
    if (await isModelInstalled(this.#modelDir, VOICE_MODEL)) {
      throw new VoiceBusyError("The model is already installed.");
    }
    const inFlight: DownloadInFlight = { controller: new AbortController(), receivedBytes: 0 };
    this.#download = inFlight;
    this.#lastError = null;
    // Deliberately not awaited: the route answers the status this moved to and
    // the surface polls for `receivedBytes` — a 32 MB fetch outlives any
    // request timeout worth having.
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
        // Only if THIS download is still the current one: a `remove` racing it
        // already aborted and cleared, and warming a model it just deleted
        // would report `preparing` for a file that is gone.
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

  /**
   * Transcribe a second of silence, ONCE, so the shader compile lands here —
   * and, because this is the first time the freshly-downloaded model is
   * actually loaded, so a model that passed the size/digest gate but cannot be
   * opened by whisper.cpp is caught HERE, at the install the user is watching,
   * rather than at their first dictation. Such a model is nuked so the status
   * drops to `no-model` with the reason, the same delete-and-rebuild recovery
   * the knowledge cache uses. A decode failure (the runtime loaded but choked
   * on silence) is recorded but keeps the model — it is not about the bytes.
   */
  #warmUp(): void {
    this.#preparing = true;
    void (async () => {
      try {
        const answer = await this.#runWorker({
          kind: "transcribe",
          modelPath: modelFilePath(this.#modelDir, VOICE_MODEL),
          pcm: new ArrayBuffer(WARM_UP_PCM_BYTES),
        });
        if (answer.kind === "failed") {
          await this.#recordWorkerFailure(answer.message, answer.modelUnusable);
        }
      } finally {
        this.#preparing = false;
      }
    })();
  }

  /**
   * What a `failed` worker answer means for the cache. A model that would not
   * LOAD is corrupt for this build, so it is deleted — a re-download is the
   * only recovery, and leaving it would report `ready` for a file that cannot
   * work. A decode failure keeps the file: the bytes are fine, the clip was
   * not. Either way the reason is remembered for the `no-model` status.
   */
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
    const problem = await this.#probe();
    if (problem !== null) {
      throw new VoiceUnavailableError(problem);
    }
    if (!(await isModelInstalled(this.#modelDir, VOICE_MODEL))) {
      throw new VoiceUnavailableError(
        `Dictation needs the ${VOICE_MODEL.label} model. Turn on voice input in Settings to download it.`,
      );
    }
    if (this.#preparing) {
      throw new VoiceBusyError("The speech model is still being prepared.");
    }
    if (this.#transcribing) {
      throw new VoiceBusyError("Another dictation is still being transcribed.");
    }
    this.#transcribing = true;
    try {
      const answer = await this.#runWorker({
        kind: "transcribe",
        modelPath: modelFilePath(this.#modelDir, VOICE_MODEL),
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
      // A model that would not load is now gone, so this is `unavailable`, not
      // a bad clip; a decode failure keeps the model and reports as one.
      throw answer.modelUnusable
        ? new VoiceUnavailableError(
            `The ${VOICE_MODEL.label} model could not be loaded and was removed. Turn voice input on again in Settings to re-download it.`,
          )
        : new VoiceTranscriptionError(answer.message);
    } finally {
      this.#transcribing = false;
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    // A download writes into the model directory; leaving one running past
    // shutdown means a partial file landing after the process said it stopped.
    this.#download?.controller.abort();
    this.#download = null;
  }
}

/**
 * The e2e runtime. It reports `ready` with no model on disk and no binding
 * loaded, and its answer NAMES THE SAMPLE COUNT — so a scenario asserting the
 * composer's text proves the microphone's bytes reached the server, not merely
 * that a button was clicked.
 */
export class ScriptedVoiceService implements VoiceService {
  async status(): Promise<VoiceStatusResponse> {
    return { state: "ready", model: wireModel(SCRIPTED_VOICE_MODEL) };
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

  async dispose(): Promise<void> {
    // Nothing to stop.
  }
}
