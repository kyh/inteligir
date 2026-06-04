// AudioWorkletProcessor — runs on the audio rendering thread, batches mic
// samples into ~128ms chunks and posts them to the main thread.
//
// Loaded by stt.ts via Vite's ?url import + audioContext.audioWorklet.addModule.
//
// This file stays `.js` (not `.ts`) because Vite's `?url` query doesn't
// transpile TypeScript — it returns the source path verbatim, which the
// worklet thread can't execute. A `.js` file is copied as-is to the build
// output and the URL points at a real loadable asset. The
// AudioWorkletProcessor / registerProcessor globals also only exist inside
// the worklet thread, which is another reason to keep the typed renderer
// project from touching this file.

// Web Audio's processing block size is 128 samples; at 16kHz that's 8ms per
// callback. Sending each block over IPC would be ~125 messages/sec — wasteful.
// 2048 samples ≈ 128ms is a better trade-off between latency and IPC cost.
const FRAME_SIZE = 2048;

class STTProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME_SIZE);
    this.offset = 0;
    // The renderer posts "flush" on stop. Forward whatever partial chunk we
    // have so the trailing ~128ms of speech isn't dropped, then ack with
    // "flushed" so the caller knows it's safe to tear down the recognizer.
    this.port.addEventListener("message", (event) => {
      if (event.data !== "flush") return;
      if (this.offset > 0) {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        this.port.postMessage(this.buffer.slice(0, this.offset));
        this.offset = 0;
      }
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      this.port.postMessage("flushed");
    });
    this.port.start();
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    let read = 0;
    while (read < channel.length) {
      const space = FRAME_SIZE - this.offset;
      const take = Math.min(space, channel.length - read);
      this.buffer.set(channel.subarray(read, read + take), this.offset);
      this.offset += take;
      read += take;
      if (this.offset === FRAME_SIZE) {
        // postMessage structured-clones; send a copy so the next iteration
        // can keep using the underlying buffer.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        this.port.postMessage(this.buffer.slice());
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("stt-processor", STTProcessor);
