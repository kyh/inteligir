import { describe, expect, it } from "vitest";

import {
  BINARY_TAG_STT_PCM,
  BINARY_TAG_TTS_PCM,
  decodeBinaryFrame,
  encodeBinaryFrame,
  parseClientFrame,
  parseServerFrame,
  WIRE_EVENT_METHODS,
  WIRE_REQUEST_METHODS,
  WIRE_SEND_METHODS,
} from "../bridge-wire";
import { IPC, IPC_METHODS, UPDATE_METHODS } from "../ipc-registry";

describe("method partitions", () => {
  it("request methods cover every host invoke/invoke-void and nothing else", () => {
    const expected = IPC_METHODS.filter((m) => {
      const kind = IPC[m].kind;
      return (
        (kind === "invoke" || kind === "invoke-void") &&
        !(UPDATE_METHODS as readonly string[]).includes(m)
      );
    });
    expect([...WIRE_REQUEST_METHODS].toSorted()).toEqual(expected.toSorted());
  });

  it("excludes the update trio from requests", () => {
    for (const method of UPDATE_METHODS) {
      expect(WIRE_REQUEST_METHODS).not.toContain(method);
    }
  });

  it("excludes sendSttAudio from send envelopes (binary-only)", () => {
    expect(WIRE_SEND_METHODS).not.toContain("sendSttAudio");
    expect(WIRE_SEND_METHODS).toContain("ttsSend");
  });

  it("excludes onTtsAudio from event envelopes (binary-only)", () => {
    expect(WIRE_EVENT_METHODS).not.toContain("onTtsAudio");
    expect(WIRE_EVENT_METHODS).toContain("onVaultChanged");
  });
});

describe("parseClientFrame", () => {
  it("round-trips a request envelope", () => {
    const text = JSON.stringify({
      t: "req",
      id: 7,
      method: "readVaultDoc",
      payload: { path: "a.md" },
    });
    expect(parseClientFrame(text)).toEqual({
      ok: true,
      frame: { t: "req", id: 7, method: "readVaultDoc", payload: { path: "a.md" } },
    });
  });

  it("round-trips a payload-less request", () => {
    expect(parseClientFrame(JSON.stringify({ t: "req", id: 1, method: "getVaultRoot" }))).toEqual({
      ok: true,
      frame: { t: "req", id: 1, method: "getVaultRoot" },
    });
  });

  it("round-trips a send envelope", () => {
    const text = JSON.stringify({ t: "snd", method: "ttsSend", payload: { text: "hi" } });
    expect(parseClientFrame(text)).toEqual({
      ok: true,
      frame: { t: "snd", method: "ttsSend", payload: { text: "hi" } },
    });
  });

  it("rejects unknown methods, wrong kinds, and non-JSON", () => {
    expect(parseClientFrame(JSON.stringify({ t: "req", id: 1, method: "nope" })).ok).toBe(false);
    // update trio never crosses the wire
    expect(
      parseClientFrame(JSON.stringify({ t: "req", id: 1, method: "checkForUpdates" })).ok,
    ).toBe(false);
    // STT audio is binary-only
    expect(
      parseClientFrame(JSON.stringify({ t: "snd", method: "sendSttAudio", payload: [1, 2] })).ok,
    ).toBe(false);
    // an event method is not callable
    expect(parseClientFrame(JSON.stringify({ t: "req", id: 1, method: "onVaultChanged" })).ok).toBe(
      false,
    );
    expect(parseClientFrame("not json").ok).toBe(false);
  });
});

describe("parseServerFrame", () => {
  it("round-trips ok / error responses", () => {
    expect(parseServerFrame(JSON.stringify({ t: "res", id: 3, ok: true, result: "x" }))).toEqual({
      ok: true,
      frame: { t: "res", id: 3, ok: true, result: "x" },
    });
    expect(parseServerFrame(JSON.stringify({ t: "res", id: 3, ok: true }))).toEqual({
      ok: true,
      frame: { t: "res", id: 3, ok: true },
    });
    expect(parseServerFrame(JSON.stringify({ t: "res", id: 4, ok: false, error: "bad" }))).toEqual({
      ok: true,
      frame: { t: "res", id: 4, ok: false, error: "bad" },
    });
  });

  it("round-trips event envelopes and rejects binary-only events", () => {
    const text = JSON.stringify({ t: "evt", method: "onVaultChanged", payload: { root: "/v" } });
    expect(parseServerFrame(text)).toEqual({
      ok: true,
      frame: { t: "evt", method: "onVaultChanged", payload: { root: "/v" } },
    });
    expect(
      parseServerFrame(JSON.stringify({ t: "evt", method: "onTtsAudio", payload: {} })).ok,
    ).toBe(false);
  });
});

describe("binary frames", () => {
  it("round-trips tag + payload", () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const frame = encodeBinaryFrame(BINARY_TAG_STT_PCM, pcm);
    expect(new Uint8Array(frame)[0]).toBe(BINARY_TAG_STT_PCM);
    const decoded = decodeBinaryFrame(frame);
    expect(decoded?.tag).toBe(BINARY_TAG_STT_PCM);
    expect([...(decoded?.payload ?? [])]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("returns an alignment-safe payload (viewable as Float32/Int16)", () => {
    const samples = new Float32Array([0.5, -0.25, 1]);
    const frame = encodeBinaryFrame(
      BINARY_TAG_STT_PCM,
      new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
    );
    const decoded = decodeBinaryFrame(frame);
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(decoded.payload.byteOffset).toBe(0);
    const view = new Float32Array(decoded.payload.buffer, 0, 3);
    expect([...view]).toEqual([0.5, -0.25, 1]);
  });

  it("decodes an offset view (node Buffer subarray) without shifting bytes", () => {
    const backing = new Uint8Array([9, 9, BINARY_TAG_TTS_PCM, 10, 20]);
    const decoded = decodeBinaryFrame(backing.subarray(2));
    expect(decoded?.tag).toBe(BINARY_TAG_TTS_PCM);
    expect([...(decoded?.payload ?? [])]).toEqual([10, 20]);
  });

  it("rejects an empty frame", () => {
    expect(decodeBinaryFrame(new ArrayBuffer(0))).toBeNull();
  });
});
