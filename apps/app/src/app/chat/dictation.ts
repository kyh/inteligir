// Turning a microphone into the bytes the voice contract names, and the state
// machine the mic button draws.
//
// CLICK-TO-TOGGLE, NOT PUSH-TO-TALK, and the deciding reason is the permission
// prompt. The first `getUserMedia` on an origin opens a browser dialog, and
// under a hold that dialog arrives DURING the hold — it takes the pointer, the
// button's pointerup never comes, and the user's first attempt records nothing
// and explains nothing. A toggle has an unambiguous start and an unambiguous
// stop, so the prompt simply happens between them. The rest follows: a hold
// that ends because the pointer left the button, because a system dialog stole
// focus, or because the window blurred is a lost dictation with no error, and
// a composer is a place where hands are already on the keyboard.
//
// THE BROWSER DOES THE RESAMPLING. `AudioContext({ sampleRate })` plus
// `decodeAudioData` runs a real resampler over whatever the microphone and the
// recorder produced; the linear interpolation below is a fallback for a
// browser that ignores the rate hint, and it is stated as the worse path
// rather than made the normal one.
//
// RECORD FIRST, DECODE AT RELEASE. MediaRecorder costs almost nothing while
// the user speaks; pulling raw frames would need an AudioWorklet, which is a
// module the page fetches as a script — and this app's production CSP names
// `worker-src 'none'` on purpose. Decoding once, after the stop, keeps
// dictation inside the policy the shell already ships.

import { VOICE_SAMPLE_RATE } from "@repo/server-contract/voice";

/**
 * What the mic button is doing. `recording` carries the level the meter draws
 * and `transcribing` carries nothing, because there is nothing honest to show
 * — the server answers in one shot and a fake progress bar would be a lie.
 */
export type DictationState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording"; level: number }
  | { kind: "transcribing" };

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

export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  // Chunked: spreading a multi-megabyte view into String.fromCharCode
  // overflows the argument limit.
  const chunk = 0x8000;
  for (let offset = 0; offset < view.length; offset += chunk) {
    binary += String.fromCharCode(...view.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/**
 * Why the microphone is not available, in words. The browser's own message is
 * not used: `NotAllowedError` reads "Permission denied", which does not tell
 * anyone which permission or where to change it.
 */
export function microphoneProblem(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
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

/** Where dictated text lands, given what the composer holds and where the
 *  caret was. Pure so the insertion rule is testable without a DOM: the
 *  transcript goes AT THE CARET, spaced from whatever it lands between, and
 *  the returned caret sits after it so typing continues from there. */
export function insertTranscript(args: {
  text: string;
  transcript: string;
  selectionStart: number;
  selectionEnd: number;
}): { text: string; caret: number } {
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

export interface CaptureHandle {
  /** Resolves with the samples the contract wants, or null if nothing was
   *  captured (a stop before any data arrived). */
  stop: () => Promise<Float32Array | null>;
  /** Latest meter level; read on a timer rather than pushed, so the caller
   *  decides how often the UI re-renders. */
  level: () => number;
  /** Drop the microphone without decoding — the abandon path. */
  cancel: () => void;
}

/**
 * Open the microphone and start recording. Rejects with whatever
 * `getUserMedia` refused, so the caller can turn it into a sentence.
 */
export async function startCapture(): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  // The meter reads the LIVE stream rather than the recorded blob, so it moves
  // while the user speaks instead of after they stop.
  const meterContext = new AudioContext();
  const analyser = meterContext.createAnalyser();
  analyser.fftSize = 512;
  meterContext.createMediaStreamSource(stream).connect(analyser);
  const frame = new Float32Array(analyser.fftSize);

  const release = (): void => {
    for (const track of stream.getTracks()) {
      track.stop();
    }
    void meterContext.close();
  };

  recorder.start();

  return {
    level: () => {
      analyser.getFloatTimeDomainData(frame);
      return levelFrom(frame);
    },
    cancel: () => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      release();
    },
    stop: async () => {
      const stopped = new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
      });
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      await stopped;
      release();
      if (chunks.length === 0) {
        return null;
      }
      const bytes = await new Blob(chunks).arrayBuffer();
      const decodeContext = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
      try {
        const audio = await decodeContext.decodeAudioData(bytes);
        return resampleTo16k(audio.getChannelData(0), audio.sampleRate);
      } finally {
        void decodeContext.close();
      }
    },
  };
}
