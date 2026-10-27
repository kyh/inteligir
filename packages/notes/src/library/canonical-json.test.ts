import { describe, expect, it } from "vitest";

import { canonicalJson, sameJson, utf8ByteLength } from "./canonical-json";
import { mulberry32 } from "../test-support/seeded-random";

describe("canonicalJson", () => {
  it("sorts keys at every depth and leaves undefined members out", () => {
    expect(canonicalJson({ b: [{ z: 1, a: null }], a: "x", c: undefined })).toBe(
      '{"a":"x","b":[{"a":null,"z":1}]}',
    );
    expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
  });
});

describe("utf8ByteLength", () => {
  it("counts the bytes the platform encoder writes, lone surrogates included (seeded)", () => {
    const rand = mulberry32(0x07_f8);
    const encoder = new TextEncoder();
    for (let trial = 0; trial < 500; trial += 1) {
      const units = Array.from({ length: Math.floor(rand() * 12) }, () =>
        Math.floor(rand() * 0x1_00_00),
      );
      const text = String.fromCodePoint(...units) + String.fromCodePoint(0x1_f6_00);
      expect(utf8ByteLength(text)).toBe(encoder.encode(text).length);
    }
  });
});
