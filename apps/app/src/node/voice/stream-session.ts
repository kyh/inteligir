// A dictation session: the thing behind ONE `/voice/stream` websocket. Frames
// come in, partials and a final go out, and it is torn down on every exit path
// — release, cancel, disconnect, app teardown.
//
// TWO IMPLEMENTATIONS OF ONE SEAM. The worker session holds a persistent
// transcription worker (the model loads ONCE and the recognizer stays open for
// the whole hold); the scripted session emits fake partials and a final with no
// worker and no native dep, so a scenario can drive the whole streaming path on
// a machine with no model.
//
// THE WORKER IS TORN DOWN, ALWAYS. `dispose` terminates it and is idempotent,
// and every path reaches it: a `final`, an `onError`, a disconnect, and the
// ordered teardown. No async path escapes without catching — the prepare and
// the spawn both fail INTO `onError` rather than out as a rejection.
//
// FRAMES ARE BOUNDED. `prepare` is async (a native probe, a filesystem check),
// so frames can arrive before the worker exists; they queue here until it does.
// Both that queue and the total audio ever forwarded are capped at
// `STREAM_MAX_SAMPLES`, so a microphone left running cannot grow this session's
// memory — or the recognizer's internal state — without limit.

import { VOICE_MAX_AUDIO_SECONDS, VOICE_SAMPLE_RATE } from "@repo/server-contract/voice";
import type { VoiceModelFiles } from "./worker-protocol";
import type { VoiceStreamWorkerCallbacks, VoiceStreamWorkerHandle } from "./voice-worker-host";

/**
 * The ceiling on ONE hold, in samples — the same two minutes the batch contract
 * caps a clip at. Past it, frames are dropped: the partial freezes and the final
 * reflects the first two minutes, which is far past a spoken composer message
 * and is what keeps a runaway microphone from growing the recognizer's state.
 */
export const STREAM_MAX_SAMPLES = VOICE_SAMPLE_RATE * VOICE_MAX_AUDIO_SECONDS;

/** What a `/voice/stream` socket is told; the hub turns these into frames. */
export interface StreamHandlers {
  onPartial(text: string): void;
  onFinal(text: string): void;
  /** A refusal for a person. The session has already resolved the user-facing
   *  sentence (including nuking a model that would not load). */
  onError(message: string): void;
}

/** One dictation session, driven by the websocket it belongs to. */
export interface StreamSession {
  /** A PCM16 chunk (Int16 LE, mono, 16 kHz). Owns the buffer — it is forwarded
   *  by transfer, so the caller must not touch it afterwards. */
  pushPcm(pcm: ArrayBuffer): void;
  /** The user released: transcribe what was fed and answer one `final`. */
  finalize(): void;
  /** Tear the worker down. Idempotent; safe on every exit path. */
  dispose(): Promise<void>;
}

function samplesIn(pcm: ArrayBuffer): number {
  return Math.floor(pcm.byteLength / 2);
}

export interface WorkerStreamSessionDeps {
  handlers: StreamHandlers;
  /** Probe the runtime and resolve the model files, or say why it cannot run. */
  prepare(): Promise<{ ok: true; model: VoiceModelFiles } | { ok: false; reason: string }>;
  /** Spawn the persistent worker for `model`, wired to these callbacks. */
  spawn(model: VoiceModelFiles, callbacks: VoiceStreamWorkerCallbacks): VoiceStreamWorkerHandle;
  /** A model the worker reported unusable was nuked; produce the user sentence. */
  onModelUnusable(): Promise<string>;
}

export class WorkerStreamSession implements StreamSession {
  readonly #deps: WorkerStreamSessionDeps;
  #worker: VoiceStreamWorkerHandle | null = null;
  #pending: ArrayBuffer[] = [];
  #totalSamples = 0;
  #finalizeRequested = false;
  #dead = false;

  constructor(deps: WorkerStreamSessionDeps) {
    this.#deps = deps;
    void this.#init();
  }

  async #init(): Promise<void> {
    let prepared: Awaited<ReturnType<WorkerStreamSessionDeps["prepare"]>>;
    try {
      prepared = await this.#deps.prepare();
    } catch (error) {
      this.#failLocal(error instanceof Error ? error.message : String(error));
      return;
    }
    if (this.#dead) {
      return;
    }
    if (!prepared.ok) {
      this.#failLocal(prepared.reason);
      return;
    }
    const worker = this.#deps.spawn(prepared.model, {
      onReady: () => undefined,
      onPartial: (text) => {
        if (!this.#dead) {
          this.#deps.handlers.onPartial(text);
        }
      },
      onFinal: (text) => {
        if (!this.#dead) {
          this.#deps.handlers.onFinal(text);
        }
        void this.dispose();
      },
      onError: (message, modelUnusable) => {
        void this.#handleWorkerError(message, modelUnusable);
      },
    });
    if (this.#dead) {
      // Disposed while prepare was in flight — do not leak the worker we just
      // spawned.
      void worker.dispose();
      return;
    }
    this.#worker = worker;
    // The port preserves order, so flushing the queued audio and only then
    // forwarding a finalize keeps "all frames before the final" true.
    for (const pcm of this.#pending) {
      worker.pushPcm(pcm);
    }
    this.#pending = [];
    if (this.#finalizeRequested) {
      worker.finalize();
    }
  }

  async #handleWorkerError(message: string, modelUnusable: boolean): Promise<void> {
    if (this.#dead) {
      return;
    }
    let reason = message;
    if (modelUnusable) {
      try {
        reason = await this.#deps.onModelUnusable();
      } catch {
        // The nuke failing does not change what the user is told.
      }
    }
    this.#failLocal(reason);
  }

  #failLocal(reason: string): void {
    if (this.#dead) {
      return;
    }
    this.#deps.handlers.onError(reason);
    void this.dispose();
  }

  pushPcm(pcm: ArrayBuffer): void {
    if (this.#dead) {
      return;
    }
    const samples = samplesIn(pcm);
    if (this.#totalSamples + samples > STREAM_MAX_SAMPLES) {
      // Past the cap: drop the frame. The final still answers what was fed.
      return;
    }
    this.#totalSamples += samples;
    if (this.#worker === null) {
      this.#pending.push(pcm);
    } else {
      this.#worker.pushPcm(pcm);
    }
  }

  finalize(): void {
    if (this.#dead) {
      return;
    }
    if (this.#worker === null) {
      this.#finalizeRequested = true;
    } else {
      this.#worker.finalize();
    }
  }

  async dispose(): Promise<void> {
    if (this.#dead) {
      return;
    }
    this.#dead = true;
    this.#pending = [];
    await this.#worker?.dispose();
  }
}

/**
 * The e2e session. It runs the WHOLE streaming path with no worker and no
 * model: it counts the samples it is fed and NAMES the count in its partials
 * and its final, so a scenario asserting the composer's text proves the
 * microphone's bytes reached the server over the socket — not merely that a
 * button was clicked.
 */
export class ScriptedStreamSession implements StreamSession {
  readonly #handlers: StreamHandlers;
  #samples = 0;
  #dead = false;

  constructor(handlers: StreamHandlers) {
    this.#handlers = handlers;
  }

  #transcript(): string {
    return `scripted dictation of ${this.#samples} samples`;
  }

  pushPcm(pcm: ArrayBuffer): void {
    if (this.#dead) {
      return;
    }
    this.#samples += samplesIn(pcm);
    // A partial per frame proves bytes are flowing DURING the hold, and it grows
    // exactly as the real recognizer's would.
    this.#handlers.onPartial(this.#transcript());
  }

  finalize(): void {
    if (this.#dead) {
      return;
    }
    this.#handlers.onFinal(this.#transcript());
  }

  async dispose(): Promise<void> {
    this.#dead = true;
  }
}
