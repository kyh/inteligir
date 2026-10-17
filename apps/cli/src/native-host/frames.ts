// Chrome's native-messaging framing: each message is a 32-bit length in the machine's own byte
// order, then that many bytes of UTF-8 JSON. Chrome refuses a message from the host over 1 MiB, so
// the host never writes one, and caps what it sends at 64 MiB, which is the most a frame from the
// browser may declare before the stream is past saving.

import { endianness } from "node:os";
import type { BrowserHostReply, BrowserHostRequest } from "@repo/contract/browser/browser-wire";

export const FRAME_TO_HOST_MAX_BYTES = 64 * 1024 * 1024;
export const FRAME_FROM_HOST_MAX_BYTES = 1024 * 1024;

const HEADER_BYTES = 4;

export type Endianness = "BE" | "LE";

export class FrameTooLargeError extends Error {
  readonly bytes: number;
  readonly limit: number;

  constructor(bytes: number, limit: number) {
    super(`a frame of ${String(bytes)} bytes is over the ${String(limit)}-byte cap`);
    this.name = "FrameTooLargeError";
    this.bytes = bytes;
    this.limit = limit;
  }
}

export type FrameEvent = { kind: "message"; value: unknown } | { kind: "malformed" };

const writeLength = (header: Buffer, length: number, order: Endianness): void => {
  if (order === "LE") {
    header.writeUInt32LE(length, 0);
  } else {
    header.writeUInt32BE(length, 0);
  }
};

const readLength = (header: Buffer, order: Endianness): number =>
  order === "LE" ? header.readUInt32LE(0) : header.readUInt32BE(0);

// what a frame carries either way: the host writes replies, and the browser (or a suite standing in
// for it) requests
export type FrameMessage = BrowserHostReply | BrowserHostRequest;

// a reply the browser would refuse is never written: the caller answers something smaller instead
export const encodeFrame = (value: FrameMessage, order: Endianness = endianness()): Buffer => {
  const body = Buffer.from(JSON.stringify(value), "utf-8");
  if (body.length > FRAME_FROM_HOST_MAX_BYTES) {
    throw new FrameTooLargeError(body.length, FRAME_FROM_HOST_MAX_BYTES);
  }
  const header = Buffer.alloc(HEADER_BYTES);
  writeLength(header, body.length, order);
  return Buffer.concat([header, body]);
};

// fatal: a body that is not UTF-8 is malformed rather than a message with replacement characters
const decoder = new TextDecoder("utf-8", { fatal: true });

const eventOf = (body: Buffer): FrameEvent => {
  try {
    const value: unknown = JSON.parse(decoder.decode(body));
    return { kind: "message", value };
  } catch {
    return { kind: "malformed" };
  }
};

export interface FrameReader {
  // every frame the bytes so far complete, in order; throws FrameTooLargeError past the cap, after
  // which the stream cannot be read on
  push: (chunk: Uint8Array) => FrameEvent[];
}

// chunks are kept as they come and joined once per frame, so a page of many megabytes read in
// 64 KiB chunks costs one copy rather than one per chunk
export const createFrameReader = (order: Endianness = endianness()): FrameReader => {
  let chunks: Buffer[] = [];
  let buffered = 0;
  let expected: number | null = null;

  const take = (length: number): Buffer => {
    const all = Buffer.concat(chunks, buffered);
    const rest = all.subarray(length);
    chunks = rest.length > 0 ? [rest] : [];
    buffered = rest.length;
    return all.subarray(0, length);
  };

  return {
    push(chunk) {
      if (chunk.length > 0) {
        chunks.push(Buffer.from(chunk));
        buffered += chunk.length;
      }
      const events: FrameEvent[] = [];
      for (;;) {
        if (expected === null) {
          if (buffered < HEADER_BYTES) {
            return events;
          }
          const length = readLength(take(HEADER_BYTES), order);
          if (length > FRAME_TO_HOST_MAX_BYTES) {
            throw new FrameTooLargeError(length, FRAME_TO_HOST_MAX_BYTES);
          }
          expected = length;
        }
        if (buffered < expected) {
          return events;
        }
        const body = take(expected);
        expected = null;
        events.push(eventOf(body));
      }
    },
  };
};

// a frame cut off by the end of the input is dropped: the peer that would read its answer is gone
export const readFrames = async function* readFrames(
  input: AsyncIterable<Uint8Array>,
  order: Endianness = endianness(),
): AsyncGenerator<FrameEvent> {
  const reader = createFrameReader(order);
  for await (const chunk of input) {
    yield* reader.push(chunk);
  }
};
