import { describe, expect, it } from "vitest";

import { fileSha } from "./file-sha";

describe(fileSha, () => {
  it("is SHA-256 over the whole of the bytes, in lowercase hex", () => {
    expect(fileSha(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("tells two files a byte apart", () => {
    expect(fileSha(new Uint8Array([1, 2, 3]))).not.toBe(fileSha(new Uint8Array([1, 2, 4])));
  });
});
