// how a device judges a cover candidate it fetched: by the picture its bytes are, and its size

import { describe, expect, it } from "vitest";

import { coverPicture, FILL_LIMITS } from "./link-fill";

// a PNG's signature and IHDR, which is all its size is read from
const pngOf = (width: number, height: number): Uint8Array => {
  const head = new Uint8Array(24);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(head.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return head;
};

describe("a cover candidate", () => {
  it("is a cover when its bytes are a picture of a cover's size, by the type they are", () => {
    expect(coverPicture(pngOf(1200, 630))).toEqual({ mime: "image/png" });
    expect(coverPicture(pngOf(FILL_LIMITS.coverMinEdge - 1, 64))).toBeNull();
    expect(coverPicture(new TextEncoder().encode("<html>not a picture</html>"))).toBeNull();
  });
});
