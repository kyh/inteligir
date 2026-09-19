// every exit path reaches dispose: prepare and spawn fail into onError, never out as a
// rejection. frames arriving before the worker exists queue here; the total is capped.

import { VOICE_MAX_AUDIO_SECONDS, VOICE_SAMPLE_RATE } from "@repo/api/local/voice/voice-schema";
import type { VoiceModelFiles } from "./worker-protocol";
import type { VoiceStreamWorkerCallbacks, VoiceStreamWorkerHandle } from "./voice-worker-host";

// past this, frames are dropped and the final reflects the first two minutes; keeps a runaway
// mic from growing the recognizer's state.
export const STREAM_MAX_SAMPLES = VOICE_SAMPLE_RATE * VOICE_MAX_AUDIO_SECONDS;

export interface StreamHandlers {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

export interface StreamSession {
  // forwarded by transfer; the caller must not touch the buffer afterwards.
  pushPcm: (pcm: ArrayBuffer) => void;
  finalize: () => void;
  // a session that stops synchronously is a session; every caller awaits either.
  dispose: () => void | Promise<void>;
}

export const samplesIn = (pcm: ArrayBuffer): number => Math.floor(pcm.byteLength / 2);

type PreparedModel = { ok: true; model: VoiceModelFiles } | { ok: false; reason: string };

export interface WorkerStreamSessionDeps {
  handlers: StreamHandlers;
  // a prepare that answers from memory is a prepare; the session awaits either.
  prepare: () => PreparedModel | Promise<PreparedModel>;
  spawn: (model: VoiceModelFiles, callbacks: VoiceStreamWorkerCallbacks) => VoiceStreamWorkerHandle;
  onModelUnusable: () => string | Promise<string>;
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
      onError: (message, modelUnusable) => {
        void this.#handleWorkerError(message, modelUnusable);
      },
      onFinal: (text) => {
        if (!this.#dead) {
          this.#deps.handlers.onFinal(text);
        }
        void this.dispose();
      },
      onPartial: (text) => {
        if (!this.#dead) {
          this.#deps.handlers.onPartial(text);
        }
      },
      onReady: () => {
        // queued audio is flushed once spawn returns; ready carries nothing for this session.
      },
    });
    if (this.#dead) {
      // disposed while prepare was in flight; do not leak the worker.
      void worker.dispose();
      return;
    }
    this.#worker = worker;
    // the port preserves order: queued audio, then the finalize.
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
      // past the cap: drop the frame; the final answers what was fed.
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
