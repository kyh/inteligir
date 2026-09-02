// every exit path reaches dispose: prepare and spawn fail into onError, never out as a
// rejection. frames arriving before the worker exists queue here; the total is capped.

import { VOICE_MAX_AUDIO_SECONDS, VOICE_SAMPLE_RATE } from "@repo/api/local/voice/voice-schema";
import type { VoiceModelFiles } from "./worker-protocol";
import type { VoiceStreamWorkerCallbacks, VoiceStreamWorkerHandle } from "./voice-worker-host";

// past this, frames are dropped and the final reflects the first two minutes; keeps a runaway
// mic from growing the recognizer's state.
export const STREAM_MAX_SAMPLES = VOICE_SAMPLE_RATE * VOICE_MAX_AUDIO_SECONDS;

export interface StreamHandlers {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onError(message: string): void;
}

export interface StreamSession {
  // forwarded by transfer; the caller must not touch the buffer afterwards.
  pushPcm(pcm: ArrayBuffer): void;
  finalize(): void;
  dispose(): Promise<void>;
}

function samplesIn(pcm: ArrayBuffer): number {
  return Math.floor(pcm.byteLength / 2);
}

export interface WorkerStreamSessionDeps {
  handlers: StreamHandlers;
  prepare(): Promise<{ ok: true; model: VoiceModelFiles } | { ok: false; reason: string }>;
  spawn(model: VoiceModelFiles, callbacks: VoiceStreamWorkerCallbacks): VoiceStreamWorkerHandle;
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

// names the sample count in its partials and final, so an e2e asserting the composer's text
// proves the mic's bytes reached the server.
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
