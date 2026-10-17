import { Readable } from "node:stream";
import { BROWSER_WIRE_VERSION } from "@repo/contract/browser/browser-wire";
import type { BrowserHostReply } from "@repo/contract/browser/browser-wire";
import { describe, expect, it } from "vitest";
import {
  createFrameReader,
  encodeFrame,
  FRAME_FROM_HOST_MAX_BYTES,
  FRAME_TO_HOST_MAX_BYTES,
  FrameTooLargeError,
  readFrames,
} from "../frames";
import type { FrameEvent } from "../frames";

const hello: BrowserHostReply = {
  appVersion: "1.2.3",
  library: "Inteligir",
  type: "hello",
  v: BROWSER_WIRE_VERSION,
};

const saved: BrowserHostReply = {
  created: true,
  path: "Unsorted/Ünïcode — “quoted”.md",
  title: "Ünïcode — “quoted”",
  type: "saved",
  v: BROWSER_WIRE_VERSION,
};

// a frame as the browser writes one: the length in the given order, then the body as it stands
const rawFrame = (body: string | Buffer, order: "BE" | "LE" = "LE"): Buffer => {
  const bytes = Buffer.from(body);
  const header = Buffer.alloc(4);
  if (order === "LE") {
    header.writeUInt32LE(bytes.length, 0);
  } else {
    header.writeUInt32BE(bytes.length, 0);
  }
  return Buffer.concat([header, bytes]);
};

const messages = (events: FrameEvent[]): unknown[] =>
  events.map((event) => (event.kind === "message" ? event.value : "malformed"));

describe("native-messaging frames", () => {
  it("round-trips a reply through the reader, multi-byte text included", () => {
    const reader = createFrameReader("LE");
    expect(messages(reader.push(encodeFrame(saved, "LE")))).toEqual([saved]);
  });

  it("reads a frame fed one byte at a time, and a header split across chunks", () => {
    const reader = createFrameReader("LE");
    const frame = encodeFrame(hello, "LE");
    const events: FrameEvent[] = [];
    for (const byte of frame) {
      events.push(...reader.push(Uint8Array.of(byte)));
    }
    expect(messages(events)).toEqual([hello]);

    const split = createFrameReader("LE");
    expect(split.push(frame.subarray(0, 2))).toEqual([]);
    expect(split.push(frame.subarray(2, 9))).toEqual([]);
    expect(messages(split.push(frame.subarray(9)))).toEqual([hello]);
  });

  it("answers every frame one chunk completes, in order, and keeps a partial one for the next", () => {
    const reader = createFrameReader("LE");
    const second = encodeFrame(saved, "LE");
    const chunk = Buffer.concat([
      encodeFrame(hello, "LE"),
      second,
      encodeFrame(hello, "LE").subarray(0, 6),
    ]);
    expect(messages(reader.push(chunk))).toEqual([hello, saved]);
    expect(messages(reader.push(encodeFrame(hello, "LE").subarray(6)))).toEqual([hello]);
  });

  it("refuses to write a reply over the browser's 1 MiB, and to read a frame past 64 MiB", () => {
    const big: BrowserHostReply = {
      detail: "x".repeat(FRAME_FROM_HOST_MAX_BYTES),
      reason: "failed",
      type: "refused",
      v: BROWSER_WIRE_VERSION,
    };
    expect(() => encodeFrame(big)).toThrow(FrameTooLargeError);

    const header = Buffer.alloc(4);
    header.writeUInt32LE(FRAME_TO_HOST_MAX_BYTES + 1, 0);
    expect(() => createFrameReader("LE").push(header)).toThrow(FrameTooLargeError);
    // exactly at the cap is a frame still to come, not a refusal
    header.writeUInt32LE(FRAME_TO_HOST_MAX_BYTES, 0);
    expect(createFrameReader("LE").push(header)).toEqual([]);
  });

  it("reads a body that is not JSON, or not UTF-8, as malformed, and goes on reading", () => {
    const reader = createFrameReader("LE");
    const events = reader.push(
      Buffer.concat([
        rawFrame("{not json"),
        rawFrame(Buffer.from([0xff, 0xfe, 0x7b, 0x7d])),
        rawFrame('{"type":"hello","v":1}'),
      ]),
    );
    expect(messages(events)).toEqual(["malformed", "malformed", { type: "hello", v: 1 }]);
  });

  it("reads the length in the byte order it was given", () => {
    const big = createFrameReader("BE");
    expect(messages(big.push(rawFrame('{"v":1}', "BE")))).toEqual([{ v: 1 }]);
    expect(encodeFrame(hello, "BE").readUInt32BE(0)).toBe(encodeFrame(hello, "LE").readUInt32LE(0));
    // read in the wrong order, a 7-byte body declares some 117 MB and is refused
    expect(() => createFrameReader("LE").push(rawFrame('{"v":1}', "BE"))).toThrow(
      FrameTooLargeError,
    );
  });

  it("reads a stream's frames and drops one the end of input cuts off", async () => {
    const frame = encodeFrame(hello);
    const input = Readable.from([frame, frame.subarray(0, 5)]);
    const events: FrameEvent[] = [];
    for await (const event of readFrames(input)) {
      events.push(event);
    }
    expect(messages(events)).toEqual([hello]);
  });
});
