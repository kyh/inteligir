import { samplesIn } from "./stream-session";
import type { StreamHandlers, StreamSession } from "./stream-session";

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

  dispose(): Promise<void> {
    this.#dead = true;
    return Promise.resolve();
  }
}
