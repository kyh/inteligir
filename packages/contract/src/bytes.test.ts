import { describe, expect, it } from "vitest";
import { base64FromBytes, bytesFromBase64, hexFromBytes, sha256Hex } from "./bytes";

describe(hexFromBytes, () => {
  it("encodes to lowercase, zero-padded hex", () => {
    expect(hexFromBytes(new Uint8Array([0, 15, 255]))).toBe("000fff");
    expect(hexFromBytes(new Uint8Array([]))).toBe("");
  });
});

describe(bytesFromBase64, () => {
  it("reads back every byte base64FromBytes wrote, the high half included", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(bytesFromBase64(base64FromBytes(bytes))).toStrictEqual(bytes);
    expect(bytesFromBase64("")).toStrictEqual(new Uint8Array());
  });
});

describe(sha256Hex, () => {
  it("matches the SHA-256 test vector for the empty string", async () => {
    await expect(sha256Hex("")).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
