// Wire-protocol tests: JSON frame round-trips, malformed-frame rejection
// (always null, never a throw), and binary tag framing — including views with
// a nonzero byteOffset, the node-Buffer-pool case the transport must respect.

import { describe, expect, it } from "vitest";

import {
  decodeBinaryFrame,
  encodeBinaryFrame,
  encodeFrame,
  parseClientFrame,
  parseServerFrame,
  type ClientFrame,
  type ServerFrame,
} from "../ws-protocol";
import { binaryChannelFor } from "../ipc-registry";

// Derived from the registry rather than hardcoded, so a retagged channel fails
// here instead of silently changing the wire.
const STT_TAG = binaryChannelFor("sendSttAudio")?.tag ?? -1;
const TTS_TAG = binaryChannelFor("onTtsAudio")?.tag ?? -1;

describe("client frames", () => {
  const frames: ClientFrame[] = [
    { t: "auth", token: "tok" },
    { t: "req", id: 1, method: "getVaultRoot" },
    { t: "req", id: 2, method: "readVaultDoc", payload: { path: "a.md" } },
    { t: "send", method: "sendSttAudio", payload: [0.25, -0.5] },
    { t: "send", method: "ttsSend", payload: { text: "hi" } },
  ];

  it.each(frames)("round-trips %j", (frame) => {
    expect(parseClientFrame(encodeFrame(frame))).toEqual(frame);
  });

  it.each([
    "not json",
    "42",
    "[1,2]",
    "null",
    JSON.stringify({ t: "nope" }),
    JSON.stringify({ t: "auth" }),
    JSON.stringify({ t: "auth", token: 7 }),
    JSON.stringify({ t: "pair", pairingToken: "pt" }),
    JSON.stringify({ t: "req", method: "x" }),
    JSON.stringify({ t: "req", id: "1", method: "x" }),
    JSON.stringify({ t: "send", payload: {} }),
  ])("rejects malformed %j as null", (text) => {
    expect(parseClientFrame(text)).toBeNull();
  });
});

describe("server frames", () => {
  const frames: ServerFrame[] = [
    { t: "welcome" },
    { t: "res", id: 3, ok: true, result: { root: "/v" } },
    { t: "res", id: 4, ok: true },
    { t: "res", id: 5, ok: false, error: "boom" },
    { t: "evt", method: "onVaultChanged", payload: { root: "/v" } },
  ];

  it.each(frames)("round-trips %j", (frame) => {
    expect(parseServerFrame(encodeFrame(frame))).toEqual(frame);
  });

  it.each([
    "not json",
    JSON.stringify({ t: "paired", deviceToken: "dt" }),
    JSON.stringify({ t: "res", ok: true }),
    JSON.stringify({ t: "res", id: 1, ok: false }),
    JSON.stringify({ t: "res", id: 1, ok: "yes" }),
    JSON.stringify({ t: "evt" }),
  ])("rejects malformed %j as null", (text) => {
    expect(parseServerFrame(text)).toBeNull();
  });
});

describe("binary frames", () => {
  it("prefixes the tag and round-trips an ArrayBuffer payload", () => {
    const pcm = new Int16Array([100, -200, 300]);
    const frame = encodeBinaryFrame(TTS_TAG, pcm.buffer);
    expect(frame[0]).toBe(TTS_TAG);
    expect(frame.byteLength).toBe(1 + pcm.byteLength);

    const decoded = decodeBinaryFrame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded?.tag).toBe(TTS_TAG);
    expect(decoded && [...new Int16Array(decoded.payload)]).toEqual([100, -200, 300]);
  });

  it("copies only the view's window when byteOffset is nonzero", () => {
    const backing = new Float32Array([9, 8, 7, 6, 5]);
    const view = backing.subarray(1, 4); // byteOffset 4, values [8, 7, 6]
    expect(view.byteOffset).toBe(4);

    const frame = encodeBinaryFrame(STT_TAG, view);
    expect(frame.byteLength).toBe(1 + view.byteLength);

    const decoded = decodeBinaryFrame(frame);
    expect(decoded?.tag).toBe(STT_TAG);
    // The payload must be a standalone, exactly-sized buffer — downstream
    // does `new Float32Array(buffer)` over the WHOLE thing.
    expect(decoded?.payload.byteLength).toBe(view.byteLength);
    expect(decoded && [...new Float32Array(decoded.payload)]).toEqual([8, 7, 6]);
  });

  it("decodes a tag-only frame as an empty payload and an empty frame as null", () => {
    const decoded = decodeBinaryFrame(encodeBinaryFrame(2, new Uint8Array(0)));
    expect(decoded?.tag).toBe(2);
    expect(decoded?.payload.byteLength).toBe(0);
    expect(decodeBinaryFrame(new ArrayBuffer(0))).toBeNull();
  });
});
