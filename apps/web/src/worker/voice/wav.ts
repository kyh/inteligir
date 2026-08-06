// ---------------------------------------------------------------------------
// Float32 PCM → a RIFF/WAVE container, because the speech model takes a FILE.
//
// The browser's capture worklet posts 16 kHz mono Float32 frames (the
// workspace's stt-worklet.js), and `@cf/openai/whisper-large-v3-turbo` takes an
// encoded audio file rather than raw samples. Forty-four bytes of header is the
// whole difference, so the conversion belongs here as arithmetic rather than as
// a dependency.
//
// Pure and allocation-explicit: this runs once per utterance over a few hundred
// kilobytes, and it is the one place the sample rate the renderer captures at
// and the sample rate the model is told about have to agree.
// ---------------------------------------------------------------------------

/** The rate the capture worklet runs its AudioContext at. Changing it here
 * without changing it there produces audio the model transcribes at the wrong
 * speed — which sounds like a bad model rather than a mismatched constant. */
export const STT_SAMPLE_RATE = 16_000;

const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

/** Wrap `samples` (mono Float32 in [-1, 1]) in a 16-bit PCM WAVE file. */
export function encodeWav(samples: Float32Array, sampleRate = STT_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * (BITS_PER_SAMPLE / 8);
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk length
  view.setUint16(20, 1, true); // format: uncompressed PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * CHANNELS * BITS_PER_SAMPLE) / 8, true); // byte rate
  view.setUint16(32, (CHANNELS * BITS_PER_SAMPLE) / 8, true); // block align
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < samples.length; index += 1) {
    // Clamped BEFORE scaling: a sample slightly past 1 would wrap to a large
    // negative int16 and land in the audio as a click.
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(HEADER_BYTES + index * 2, Math.round(sample * 32_767), true);
  }
  return new Uint8Array(buffer);
}

/**
 * Narrow a `sendSttAudio` payload to Float32 samples, or `null` when it is
 * neither an ArrayBuffer nor a view over one.
 *
 * The registry types that channel `unknown` on purpose — TypeBox has no
 * ArrayBuffer primitive — so proving the shape is the handler's job. The binary
 * transport hands over a standalone ArrayBuffer, but the SAME registry entry is
 * reachable over a JSON `send` frame carrying arbitrary JSON, so this refuses
 * rather than reaching for `.buffer` off an object that may not have one.
 */
export function toFloat32Samples(payload: unknown): Float32Array | null {
  if (payload instanceof ArrayBuffer) {
    return payload.byteLength % Float32Array.BYTES_PER_ELEMENT === 0
      ? new Float32Array(payload)
      : null;
  }
  if (ArrayBuffer.isView(payload)) {
    // Honour byteOffset/byteLength: a view may sit inside a larger pooled
    // buffer, and reading from offset zero would take the neighbours' bytes.
    if (payload.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return null;
    return new Float32Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
  }
  return null;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
