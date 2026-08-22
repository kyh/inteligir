// Turning a microphone into the bytes the voice contract names, and the state
// machine the mic button draws.
//
// CLICK-TO-TOGGLE, NOT PUSH-TO-TALK, and the deciding reason is the permission
// prompt. The first `getUserMedia` on an origin opens a browser dialog, and
// under a hold that dialog arrives DURING the hold — it takes the pointer, the
// button's pointerup never comes, and the user's first attempt records nothing
// and explains nothing. A toggle has an unambiguous start and an unambiguous
// stop, so the prompt simply happens between them.
//
// FRAMES ARE STREAMED, NOT RECORDED. Dictation is live now (issue #578): raw
// PCM chunks go up a websocket as the user speaks, and partials come back. That
// needs the audio graph's own frames, which a `ScriptProcessorNode` delivers on
// the main thread — deliberately NOT an `AudioWorklet`, whose module the page
// would have to fetch as a script, and this app's production CSP names
// `worker-src 'none'` on purpose. ScriptProcessorNode is deprecated but loads no
// module, so it is the one raw-frame source the policy admits. The capture
// context is opened AT 16 kHz so its resampler does the work; the linear
// fallback below only runs if a browser ignores that hint.

import { VOICE_SAMPLE_RATE } from "@repo/server-contract/voice";

/**
 * What the mic button is doing. `recording` carries the level the meter draws;
 * the live partial transcript is the composer preview's to render, not this state's — a
 * partial that updated here would re-render the button on every frame.
 */
export type DictationState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording"; level: number }
  | { kind: "finalizing" };

/** ~128 ms of 16 kHz audio per frame: enough to transcribe incrementally, small
 *  enough to feel live. A power of two, as `createScriptProcessor` requires. */
const FRAME_SAMPLES = 2048;

/** Zero to one, from the analyser's time-domain RMS. */
export function levelFrom(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / samples.length);
  // Speech RMS sits near 0.05–0.2, so the raw value would keep the meter flat.
  return Math.min(1, rms * 6);
}

/** Linear interpolation, used only when the browser gave us a rate we did not
 *  ask for. Aliasing is real and accepted here: the alternative is a filter
 *  this app would have to own, for a path a modern browser never takes. */
export function resampleTo16k(samples: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === VOICE_SAMPLE_RATE) {
    return samples;
  }
  const ratio = sourceRate / VOICE_SAMPLE_RATE;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = position - left;
    out[index] = (samples[left] ?? 0) * (1 - fraction) + (samples[right] ?? 0) * fraction;
  }
  return out;
}

/** Float samples to the contract's format: little-endian signed 16-bit. */
export function toPcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    // Clamped before scaling: a sample past ±1 wraps to the opposite extreme
    // as an Int16, which is a click rather than a clip.
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, Math.round(clamped * 0x7fff), true);
  }
  return buffer;
}

/**
 * Why the microphone is not available, in words. The browser's own message is
 * not used: `NotAllowedError` reads "Permission denied", which does not tell
 * anyone which permission or where to change it.
 */
export function microphoneProblem(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "The microphone is blocked. Allow it for this site, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found on this machine.";
    case "NotReadableError":
      return "The microphone is in use by another application.";
    default:
      return "The microphone could not be opened.";
  }
}

/** The composer after a transcript lands: the whole text, and where the caret
 *  sits in it. */
export interface TranscriptInsertion {
  text: string;
  caret: number;
}

/** Where dictated text lands, given what the composer holds and where the caret
 *  was. Pure so the insertion rule is testable without a DOM: the transcript
 *  goes AT THE CARET, spaced from whatever it lands between, and the returned
 *  caret sits after it so typing continues from there. */
export function insertTranscript(args: {
  text: string;
  transcript: string;
  selectionStart: number;
  selectionEnd: number;
}): TranscriptInsertion {
  const transcript = args.transcript.trim();
  if (transcript === "") {
    return { text: args.text, caret: args.selectionEnd };
  }
  const start = Math.max(0, Math.min(args.selectionStart, args.text.length));
  const end = Math.max(start, Math.min(args.selectionEnd, args.text.length));
  const before = args.text.slice(0, start);
  const after = args.text.slice(end);
  const lead = before !== "" && !/\s$/u.test(before) ? " " : "";
  const trail = after !== "" && !/^\s/u.test(after) ? " " : "";
  const inserted = `${lead}${transcript}${trail}`;
  return { text: `${before}${inserted}${after}`, caret: start + inserted.length };
}

/** The composer fields dictation reads at accept time. An `HTMLTextAreaElement`
 *  satisfies this, and so does a plain object in a test. */
export interface ComposerSelection {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

/**
 * Splice a transcript into the LIVE composer. Both the base text AND the caret
 * come from `composer` — never a base captured in a render closure, which the
 * seconds-long dictation makes stale the instant the user types while the hold
 * is running. Reading the base from the closure and the caret from the DOM was
 * the mis-splice: the caret indexed text the base did not have. `fallback`
 * stands in only when the composer is gone (unmounted mid-flight), where there
 * is nothing live left to read.
 */
export function spliceIntoComposer(
  composer: ComposerSelection | null,
  fallback: string,
  transcript: string,
): { text: string; caret: number } {
  const base = composer === null ? fallback : composer.value;
  const start = composer?.selectionStart ?? base.length;
  const end = composer?.selectionEnd ?? base.length;
  return insertTranscript({ text: base, transcript, selectionStart: start, selectionEnd: end });
}

export interface StreamCaptureHandle {
  /** Latest meter level; read on a timer rather than pushed, so the caller
   *  decides how often the UI re-renders. */
  level: () => number;
  /** Stop the microphone and the audio graph. Frames already streamed are the
   *  caller's to finalize over the wire — there is nothing to decode here. */
  stop: () => void;
}

/**
 * Open the microphone and stream 16 kHz mono PCM16 frames to `onFrame` as they
 * arrive (~every 128 ms). Rejects with whatever `getUserMedia` refused, so the
 * caller can turn it into a sentence.
 *
 * Once `getUserMedia` grants, the microphone is LIVE — the OS indicator is lit
 * and the tracks are open. So everything built after it runs under a guard: if
 * any constructor throws, the stream is released before the rejection
 * propagates, or the mic stays hot with no handle left to stop it.
 */
export async function startStreamingCapture(
  onFrame: (pcm: ArrayBuffer) => void,
): Promise<StreamCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let context: AudioContext | null = null;
  try {
    // Ask for 16 kHz so the context's own resampler feeds sherpa's rate; the
    // linear fallback covers a browser that ignores the hint.
    context = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(FRAME_SAMPLES, 1, 1);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    source.connect(processor);
    // A ScriptProcessorNode only fires while connected to a destination; its
    // output buffer is left untouched, so what reaches the speakers is silence.
    processor.connect(context.destination);
    const meterFrame = new Float32Array(analyser.fftSize);
    const sourceRate = context.sampleRate;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      onFrame(toPcm16(resampleTo16k(input, sourceRate)));
    };

    const closing = context;
    return {
      level: () => {
        analyser.getFloatTimeDomainData(meterFrame);
        return levelFrom(meterFrame);
      },
      stop: () => {
        processor.onaudioprocess = null;
        processor.disconnect();
        source.disconnect();
        analyser.disconnect();
        for (const track of stream.getTracks()) {
          track.stop();
        }
        void closing.close();
      },
    };
  } catch (error) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
    if (context !== null) {
      void context.close();
    }
    throw error;
  }
}
