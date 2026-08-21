// The pure half of dictation: the sample conversion the wire format depends
// on, and the insertion rule the composer depends on. Both are the places a
// silent wrong answer is possible — a clipped sample is a click nobody traces
// to this file, and an insertion that eats a space is a sentence nobody can
// see was ever wrong.

import { VOICE_SAMPLE_RATE } from "@repo/server-contract/voice";
import { describe, expect, it } from "vitest";
import {
  insertTranscript,
  levelFrom,
  resampleTo16k,
  spliceIntoComposer,
  toPcm16,
} from "../dictation";

describe("toPcm16", () => {
  it("writes little-endian signed samples", () => {
    const view = new DataView(toPcm16(Float32Array.from([0, 1, -1])));
    expect(view.byteLength).toBe(6);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(0x7fff);
    expect(view.getInt16(4, true)).toBe(-0x7fff);
  });

  it("clamps rather than wrapping, so an overshoot is a clip and not a click", () => {
    const view = new DataView(toPcm16(Float32Array.from([1.5, -1.5])));
    expect(view.getInt16(0, true)).toBe(0x7fff);
    expect(view.getInt16(2, true)).toBe(-0x7fff);
  });
});

describe("resampleTo16k", () => {
  it("returns the same samples when the browser already gave us 16 kHz", () => {
    const samples = Float32Array.from([0.1, 0.2, 0.3]);
    expect(resampleTo16k(samples, VOICE_SAMPLE_RATE)).toBe(samples);
  });

  it("decimates a 48 kHz buffer to a third of its length", () => {
    const samples = new Float32Array(48_000);
    expect(resampleTo16k(samples, 48_000).length).toBe(16_000);
  });
});

describe("levelFrom", () => {
  it("is zero for silence and saturates for a loud frame", () => {
    expect(levelFrom(new Float32Array(64))).toBe(0);
    expect(levelFrom(new Float32Array(64).fill(1))).toBe(1);
  });
});

describe("insertTranscript", () => {
  it("appends to an empty composer with no leading space", () => {
    expect(
      insertTranscript({ text: "", transcript: "hello", selectionStart: 0, selectionEnd: 0 }),
    ).toEqual({ text: "hello", caret: 5 });
  });

  it("spaces itself off the words on either side", () => {
    expect(
      insertTranscript({ text: "abcd", transcript: "X", selectionStart: 2, selectionEnd: 2 }),
    ).toEqual({ text: "ab X cd", caret: 5 });
  });

  it("does not double a space that is already there", () => {
    expect(
      insertTranscript({ text: "ab ", transcript: "X", selectionStart: 3, selectionEnd: 3 }),
    ).toEqual({ text: "ab X", caret: 4 });
  });

  it("replaces a selection", () => {
    expect(
      insertTranscript({ text: "keep drop", transcript: "X", selectionStart: 5, selectionEnd: 9 }),
    ).toEqual({ text: "keep X", caret: 6 });
  });

  it("leaves the composer alone when nothing was said", () => {
    expect(
      insertTranscript({ text: "kept", transcript: "   ", selectionStart: 1, selectionEnd: 1 }),
    ).toEqual({ text: "kept", caret: 1 });
  });

  it("clamps a caret past the end rather than producing undefined text", () => {
    expect(
      insertTranscript({ text: "ab", transcript: "X", selectionStart: 99, selectionEnd: 99 }),
    ).toEqual({ text: "ab X", caret: 4 });
  });
});

describe("spliceIntoComposer", () => {
  it("splices against the LIVE composer value, not the stale fallback", () => {
    // The repro: the user typed into the composer DURING the transcription
    // round-trip. The fallback is what the composer held when the mic was armed
    // ("old"); splicing against it would discard the edit and land the caret in
    // text the base never had.
    const live = { value: "typed while waiting", selectionStart: 19, selectionEnd: 19 };
    expect(spliceIntoComposer(live, "old", "dictated")).toEqual({
      text: "typed while waiting dictated",
      caret: 28,
    });
  });

  it("inserts at the live caret, keeping text on both sides", () => {
    const live = { value: "before after", selectionStart: 6, selectionEnd: 6 };
    expect(spliceIntoComposer(live, "ignored", "MID")).toEqual({
      text: "before MID after",
      caret: 10,
    });
  });

  it("falls back to the closure value only when the composer is gone", () => {
    expect(spliceIntoComposer(null, "kept", "added")).toEqual({
      text: "kept added",
      caret: 10,
    });
  });

  it("treats a null selection as the end of the live value", () => {
    const live = { value: "abc", selectionStart: null, selectionEnd: null };
    expect(spliceIntoComposer(live, "x", "Y")).toEqual({ text: "abc Y", caret: 5 });
  });
});
