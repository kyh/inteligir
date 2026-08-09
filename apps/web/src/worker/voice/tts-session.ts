// ---------------------------------------------------------------------------
// Text-to-speech, buffered and synthesized PER DURABLE OBJECT.
//
// THE BUG THIS SHAPE EXISTS TO PREVENT. An upstream socket or a text buffer at
// MODULE scope would be catastrophic in a Worker isolate: one isolate serves
// many tenants' objects, so a module-level buffer would stream one user's note
// text into another user's headphones. Everything here is instance state,
// constructed with the object it belongs to — the same rule
// ../host/host-composition states for every part of a host, restated because
// this one carries note CONTENT.
//
// ONE REQUEST PER CHUNK, not a persistent upstream. A Durable Object holding a
// long-lived WebSocket to ElevenLabs would be pinned for the whole conversation
// and would hit the fifteen-minute outbound ceiling mid-sentence. So text is
// buffered here and synthesized over one HTTP request per speakable chunk; the
// client still receives `onTtsAudio` frames of raw PCM and plays them frame by
// frame.
//
// SPEAKABLE CHUNKS, NOT DELTAS. `ttsSend` arrives once per streamed assistant
// delta — a few characters — and one request per delta would be absurd. So
// text accumulates until it contains a sentence terminator, and the cut is at
// the LAST one, so a request always ends on a prosody boundary. `ttsFlush`
// speaks whatever is left, terminator or not.
// ---------------------------------------------------------------------------

/** Sentence terminators the cut looks for. Deliberately not a locale-aware
 * segmenter: the fallback below (speak at the ceiling) already covers text this
 * misses, and a segmenter would make the cut depend on a locale nothing here
 * knows. */
const TERMINATORS = new Set([".", "!", "?", "。", "！", "？", "\n"]);

/** Below this a buffer waits for more text even with a terminator in it —
 * "Yes." on its own is a whole request for two syllables. */
const MIN_CHUNK_CHARS = 60;

/** Above this the buffer is spoken with or without a terminator. A model that
 * streams a long list with no punctuation must not leave the user in silence. */
const MAX_CHUNK_CHARS = 400;

/** How many unspoken chunks may queue up. Past this the oldest are dropped:
 * audio the user stopped waiting for is not worth an object's residency, and
 * the alternative is an unbounded queue fed by an unbounded stream. */
const MAX_QUEUED_CHUNKS = 16;

/**
 * Turn one text chunk into PCM, calling `onAudio` for each piece as it arrives.
 *
 * A port rather than a direct call so the queueing, the cut and the epoch guard
 * below are testable with no ElevenLabs account and no network — the same seam
 * ../agent/sandbox-port keeps for the container.
 */
export type TtsSynthesizer = (
  text: string,
  signal: AbortSignal,
  onAudio: (pcm: Uint8Array) => void,
) => Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;

export type TtsSessionDeps = {
  readonly synthesize: TtsSynthesizer;
  /** Push one PCM frame to this user's sockets (`onTtsAudio`, a binary channel). */
  readonly emitAudio: (pcm: Uint8Array) => void;
  /** Work the object must not be evicted before finishing — `ctx.waitUntil`.
   * `ttsSend` is a fire-and-forget channel, so without this the synthesis it
   * starts could be cut off by an eviction the caller never hears about. */
  readonly defer: (work: Promise<unknown>) => void;
  /** Whether TTS is configured at all. Checked per chunk rather than cached:
   * a key saved mid-session must take effect without a reconnect. */
  readonly available: () => boolean;
};

/**
 * Split a buffer into the chunks that are ready to be spoken and the remainder.
 *
 * Pure and exported for its own test: this is the whole cadence decision, and
 * getting it wrong is either one request per keystroke or a user waiting in
 * silence for a paragraph to finish.
 */
export function cutSpeakable(buffer: string): { chunks: string[]; rest: string } {
  const chunks: string[] = [];
  let rest = buffer;
  for (;;) {
    if (rest.length >= MAX_CHUNK_CHARS) {
      // No terminator in reach — speak up to the ceiling, preferring the last
      // space so a word is not split across two requests.
      const window = rest.slice(0, MAX_CHUNK_CHARS);
      const space = window.lastIndexOf(" ");
      const cut = space > MIN_CHUNK_CHARS ? space + 1 : MAX_CHUNK_CHARS;
      const head = rest.slice(0, cut).trim();
      if (head !== "") chunks.push(head);
      rest = rest.slice(cut);
      continue;
    }
    const cut = lastTerminator(rest);
    if (cut < MIN_CHUNK_CHARS) break;
    const head = rest.slice(0, cut).trim();
    if (head !== "") chunks.push(head);
    rest = rest.slice(cut);
  }
  return { chunks, rest };
}

/** One index past the last sentence terminator, or 0 when there is none. */
function lastTerminator(text: string): number {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (TERMINATORS.has(text[index] ?? "")) return index + 1;
  }
  return 0;
}

export class TtsSession {
  private readonly deps: TtsSessionDeps;

  /** Text received but not yet long enough (or terminated enough) to speak. */
  private buffer = "";

  /** Serializes synthesis so PCM reaches the client in the order the text
   * arrived. The client schedules each frame after the previous one's
   * duration, so out-of-order audio is not a glitch — it is a different
   * sentence. */
  private tail: Promise<void> = Promise.resolve();

  /** How many chunks are queued or running, so the bound above is enforceable
   * without inspecting the promise chain. */
  private queued = 0;

  /**
   * Bumped by every interrupt. A queued chunk carries the epoch it was enqueued
   * under and does nothing when it no longer matches — which is what makes
   * "stop talking" instant rather than "stop after the queue drains".
   */
  private epoch = 0;

  /** The in-flight request, so an interrupt ends the upstream connection rather
   * than only discarding what it produces. */
  private current: AbortController | null = null;

  constructor(deps: TtsSessionDeps) {
    this.deps = deps;
  }

  /** Accept text to speak. Everything below a speakable chunk just accumulates. */
  send(text: string): void {
    if (text === "") return;
    this.buffer += text;
    const cut = cutSpeakable(this.buffer);
    this.buffer = cut.rest;
    for (const chunk of cut.chunks) this.enqueue(chunk);
  }

  /** End of utterance: speak the remainder, terminator or not. */
  flush(): void {
    const remainder = this.buffer.trim();
    this.buffer = "";
    if (remainder !== "") this.enqueue(remainder);
  }

  /** Stop talking now: drop the buffer, invalidate the queue, and end the
   * upstream request so the object stops paying for audio nobody will hear. */
  interrupt(): void {
    this.buffer = "";
    this.epoch += 1;
    this.queued = 0;
    this.current?.abort();
    this.current = null;
  }

  private enqueue(chunk: string): void {
    if (!this.deps.available()) return;
    if (this.queued >= MAX_QUEUED_CHUNKS) return;
    const epoch = this.epoch;
    this.queued += 1;
    const run = this.tail.then(() => this.speak(chunk, epoch));
    this.tail = run.catch(() => undefined);
    this.deps.defer(this.tail);
  }

  private async speak(chunk: string, epoch: number): Promise<void> {
    if (epoch !== this.epoch) return;
    const controller = new AbortController();
    this.current = controller;
    try {
      await this.deps.synthesize(chunk, controller.signal, (pcm) => {
        // Re-checked per frame: an interrupt lands mid-response, and the frames
        // already in the reader's buffer belong to the sentence the user just
        // stopped.
        if (epoch === this.epoch) this.deps.emitAudio(pcm);
      });
    } finally {
      if (this.current === controller) this.current = null;
      if (epoch === this.epoch) this.queued = Math.max(0, this.queued - 1);
    }
  }
}
