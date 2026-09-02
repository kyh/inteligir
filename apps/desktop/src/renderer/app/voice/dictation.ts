// Click-to-toggle, not push-to-talk: the first getUserMedia opens a permission
// dialog that takes the pointer mid-hold, so the button's pointerup never comes.
// ScriptProcessorNode, not AudioWorklet: a worklet module is fetched as a
// script, and the production CSP names `worker-src 'none'`.

import { VOICE_SAMPLE_RATE } from "@repo/api/local/voice/voice-schema";

// The partial transcript is not state here: it would re-render the button on
// every frame.
export type DictationState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording"; level: number }
  | { kind: "finalizing" };

// ~128 ms at 16 kHz; a power of two, as createScriptProcessor requires.
const FRAME_SAMPLES = 2048;

export function levelFrom(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / samples.length);
  // Speech RMS sits near 0.05–0.2, so the raw value would keep the meter flat.
  return Math.min(1, rms * 6);
}

// Linear interpolation; aliasing is accepted because a browser honouring the
// 16 kHz hint never reaches this.
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

export function toPcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    // A sample past ±1 would wrap as an Int16: a click rather than a clip.
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, Math.round(clamped * 0x7fff), true);
  }
  return buffer;
}

// Not the browser's own message: `NotAllowedError` reads "Permission denied",
// naming neither the permission nor where to change it.
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

export interface TranscriptInsertion {
  text: string;
  caret: number;
}

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

export interface ComposerSelection {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

// Base and caret both come from the live composer: a base captured in a render
// closure goes stale the moment the user types mid-dictation, and the caret
// then indexes text the base never had.
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
  level: () => number;
  stop: () => void;
}

// Once getUserMedia grants, the microphone is live: a constructor throwing
// after it must release the stream, or the mic stays hot with no handle to
// stop it.
export async function startStreamingCapture(
  onFrame: (pcm: ArrayBuffer) => void,
): Promise<StreamCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let context: AudioContext | null = null;
  try {
    // 16 kHz so the context's own resampler does the work.
    context = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(FRAME_SAMPLES, 1, 1);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    source.connect(processor);
    // A ScriptProcessorNode only fires while connected to a destination; the
    // untouched output buffer plays as silence.
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
