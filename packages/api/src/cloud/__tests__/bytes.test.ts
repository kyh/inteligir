import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  exceedsUtf8Bytes,
  hexFromBytes,
  sha256Hex,
  utf8ByteLength,
} from "../bytes";

describe("hexFromBytes", () => {
  it("encodes to lowercase, zero-padded hex", () => {
    expect(hexFromBytes(new Uint8Array([0, 15, 255]))).toBe("000fff");
    expect(hexFromBytes(new Uint8Array([]))).toBe("");
  });
});

describe("sha256Hex", () => {
  it("matches the SHA-256 test vector for the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

// The approval-state compare, spelled by hand because Hermes has no timing-safe primitive.
describe("constantTimeEqual", () => {
  it("is true only for identical strings, length differences included", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("a".repeat(43), "a".repeat(43))).toBe(true);
    expect(constantTimeEqual(`${"a".repeat(42)}b`, "a".repeat(43))).toBe(false);
  });
});

describe("utf8ByteLength", () => {
  it("agrees with the encoder, a surrogate pair counting once as its four bytes", () => {
    for (const value of ["", "ascii", "é", "あ", "😀", "a😀あé"]) {
      expect(utf8ByteLength(value)).toBe(new TextEncoder().encode(value).byteLength);
    }
  });
});

describe("exceedsUtf8Bytes", () => {
  it("is true only past the limit", () => {
    expect(exceedsUtf8Bytes("あ", 3)).toBe(false);
    expect(exceedsUtf8Bytes("あ", 2)).toBe(true);
  });
});
