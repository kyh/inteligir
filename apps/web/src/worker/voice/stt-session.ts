// ---------------------------------------------------------------------------
// Speech-to-text over a REQUEST/RESPONSE model, and what that changes.
//
// The desktop ran sherpa-onnx with a streaming Parakeet model in-process: a
// native binary plus a downloaded model directory, both of which are simply
// gone here — there is no per-user writable disk and no local inference. The
// replacement is Workers AI, and the model choice is
// `@cf/openai/whisper-large-v3-turbo`.
//
// WHY WHISPER RATHER THAN `@cf/deepgram/flux`. Flux is the better fit on
// paper — it is built for voice agents, speaks a realtime WebSocket, and does
// model-driven turn detection. It is the wrong fit for a Durable Object: a
// live upstream WebSocket PINS the object for the whole utterance and bills its
// wall-clock duration, and the object's own hibernation contract says no
// in-memory field may hold anything a later message needs — an open socket is
// exactly such a field. Whisper is one request per transcription, which is the
// shape everything else in this host already has.
//
// WHAT THAT COSTS, and it is a real regression rather than a wash. The desktop
// emitted a partial transcript every ~128 ms frame, straight out of a streaming
// decoder, and the renderer's voice machine was tuned against that cadence.
// Request/response has no decoder state to read, so a partial can only be a
// FULL RE-TRANSCRIPTION of the audio so far. Partials therefore arrive on a
// duration cadence (`PARTIAL_INTERVAL_MS`) rather than per frame, they cost a
// model call each, and the count is capped — so a long utterance degrades to
// "the final transcript arrives at stop", which is the honest floor of this
// transport.
// ---------------------------------------------------------------------------

import { encodeWav, STT_SAMPLE_RATE } from "./wav";

/** Transcribe one WAV file. A port, so the buffering, the partial cadence and
 * the caps below are testable with no Workers AI binding and no network. */
export type SttTranscriber = (
  wav: Uint8Array,
) => Promise<
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string }
>;

/**
 * How much speech accumulates before a partial is transcribed.
 *
 * Five seconds because each partial re-transcribes everything so far, so the
 * cost of the utterance is quadratic in the number of partials. Shorter feels
 * better and pays for it twice.
 */
const PARTIAL_INTERVAL_MS = 5_000;

/** Partials per utterance. Past this only the final transcription runs — a
 * two-minute monologue must not cost twenty-four whole-buffer passes. */
const MAX_PARTIALS = 6;

/** Longest utterance held in memory (2 minutes of 16 kHz mono Float32 ≈ 7.7 MB).
 * Past this the oldest audio is dropped rather than growing an object's memory
 * without limit — a session nobody stopped is the case this bounds. */
const MAX_UTTERANCE_SAMPLES = STT_SAMPLE_RATE * 120;

/** One transcript delivery, as the registry spells it. */
export type SttTranscript = { text: string; isFinal: boolean };

export type SttSessionDeps = {
  readonly transcribe: SttTranscriber;
  /** Push an interim transcript to this user's sockets (`onSttTranscript`). */
  readonly emitTranscript: (transcript: SttTranscript) => void;
  /** Work the object must not be evicted before finishing — a partial is
   * started from the fire-and-forget audio channel. */
  readonly defer: (work: Promise<unknown>) => void;
  /** Whether this deployment can transcribe at all (a Workers AI binding). */
  readonly available: () => boolean;
};

export class SttSession {
  private readonly deps: SttSessionDeps;

  /** The utterance so far. In memory, and that is what a session IS: an
   * eviction mid-dictation loses the audio, and the renderer's own stop path
   * reports the failure rather than pretending silence was speech. */
  private samples: Float32Array[] = [];
  private sampleCount = 0;

  private listening = false;
  private partialsRun = 0;
  private samplesAtLastPartial = 0;
  /** Serializes the partial passes against the final one, so `stop` never reads
   * a buffer a partial is halfway through encoding. */
  private tail: Promise<void> = Promise.resolve();

  constructor(deps: SttSessionDeps) {
    this.deps = deps;
  }

  /** Open a dictation session. Idempotent: a second start on a live session
   * resets it, which is what a renderer that lost its stop ack means by it. */
  start(): { ok: true } | { ok: false; error: string } {
    if (!this.deps.available()) {
      return { ok: false, error: "Speech recognition is not configured on this deployment." };
    }
    this.reset();
    this.listening = true;
    return { ok: true };
  }

  /** One captured frame. Fire-and-forget: a frame that arrives after `stop` is
   * dropped rather than reopening a session the user closed. */
  push(frame: Float32Array): void {
    if (!this.listening) return;
    this.samples.push(frame);
    this.sampleCount += frame.length;
    this.trim();
    if (this.dueForPartial()) this.runPartial();
  }

  /**
   * End the session and answer the final transcript.
   *
   * Returned rather than emitted, because the renderer stops listening to
   * `onSttTranscript` before it calls this — the tail events are the return
   * value by contract, and an emission here would be dropped on the floor.
   */
  async stop(): Promise<SttTranscript[]> {
    if (!this.listening) return [];
    this.listening = false;
    const audio = this.take();
    this.reset();
    if (audio.length === 0) return [];
    const result = await this.chain(() => this.deps.transcribe(encodeWav(audio)));
    if (!result.ok || result.text.trim() === "") return [];
    return [{ text: result.text.trim(), isFinal: true }];
  }

  // ---- internals ------------------------------------------------------------

  private dueForPartial(): boolean {
    if (this.partialsRun >= MAX_PARTIALS) return false;
    const since = this.sampleCount - this.samplesAtLastPartial;
    return since >= (STT_SAMPLE_RATE * PARTIAL_INTERVAL_MS) / 1000;
  }

  private runPartial(): void {
    this.partialsRun += 1;
    this.samplesAtLastPartial = this.sampleCount;
    const audio = this.take();
    const epoch = this.partialsRun;
    const work = this.chain(async () => {
      const result = await this.deps.transcribe(encodeWav(audio));
      // A partial that lands after the session ended, or after a later partial
      // already reported more, would move the interim text BACKWARDS.
      if (!this.listening || epoch !== this.partialsRun) return;
      if (result.ok && result.text.trim() !== "") {
        this.deps.emitTranscript({ text: result.text.trim(), isFinal: false });
      }
    });
    this.deps.defer(work);
  }

  /** Run `work` after whatever pass is already going, and keep the chain alive
   * through a failure so one bad transcription cannot wedge the session. */
  private chain<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** The utterance so far as one contiguous buffer. */
  private take(): Float32Array {
    const audio = new Float32Array(this.sampleCount);
    let offset = 0;
    for (const frame of this.samples) {
      audio.set(frame, offset);
      offset += frame.length;
    }
    return audio;
  }

  /** Drop the oldest frames once the utterance passes the cap. */
  private trim(): void {
    while (this.sampleCount > MAX_UTTERANCE_SAMPLES && this.samples.length > 0) {
      const dropped = this.samples.shift();
      this.sampleCount -= dropped?.length ?? 0;
    }
  }

  private reset(): void {
    this.samples = [];
    this.sampleCount = 0;
    this.partialsRun = 0;
    this.samplesAtLastPartial = 0;
  }
}
