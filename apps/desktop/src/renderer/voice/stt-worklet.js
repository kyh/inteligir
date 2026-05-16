// AudioWorkletProcessor — runs on the audio rendering thread, batches mic
// samples into ~128ms chunks and posts them to the main thread.
//
// Loaded by stt.ts via Vite's ?url import + audioContext.audioWorklet.addModule.
// Written in JS because AudioWorkletProcessor / registerProcessor are globals
// only available inside the worklet thread — typing them in the TS project
// requires a dedicated tsconfig.

// Web Audio's processing block size is 128 samples; at 16kHz that's 8ms per
// callback. Sending each block over IPC would be ~125 messages/sec — wasteful.
// 2048 samples ≈ 128ms is a better trade-off between latency and IPC cost.
const FRAME_SIZE = 2048;

class STTProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME_SIZE);
    this.offset = 0;
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
        this.port.postMessage(this.buffer.slice());
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("stt-processor", STTProcessor);
