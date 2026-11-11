import { describe, expect, it } from "vitest";

import { pixelSize, sniffMedia } from "./sniff-media";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

// a PNG's signature and IHDR, which is all its size is read from
const pngOf = (width: number, height: number): Uint8Array => {
  const head = new Uint8Array(24);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(head.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return head;
};
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

describe(sniffMedia, () => {
  it.each([
    [bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg"],
    [pngOf(1, 1), "image/png"],
    [ascii("GIF89a......"), "image/gif"],
    [ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "), "image/webp"],
    [ascii("\u0000\u0000\u0000\u0018ftypavif"), "image/avif"],
    [ascii("\u0000\u0000\u0000\u0018ftypheic"), "image/heic"],
    [ascii("%PDF-1.7\n"), "application/pdf"],
    [
      ascii('<?xml version="1.0"?>\n<!-- a comment -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'),
      "image/svg+xml",
    ],
  ] as const)("reads %s by its bytes as %s", (input, mediaType) => {
    expect(sniffMedia(input)?.mediaType).toBe(mediaType);
  });

  it("reads nothing else, whatever the site claims", () => {
    expect(sniffMedia(ascii("<!doctype html><p>a page</p>"))).toBeNull();
    expect(sniffMedia(ascii("PK\u0003\u0004"))).toBeNull();
  });
});

describe(pixelSize, () => {
  it("reads a picture's size from its header", () => {
    expect(pixelSize(pngOf(640, 400), "image/png")).toStrictEqual({ height: 400, width: 640 });
    const gif = new Uint8Array([...ascii("GIF89a"), 0x40, 0x01, 0xc8, 0x00]);
    expect(pixelSize(gif, "image/gif")).toStrictEqual({ height: 200, width: 320 });
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x58, 0x03);
    expect(pixelSize(jpeg, "image/jpeg")).toStrictEqual({ height: 400, width: 600 });
  });

  it("answers null for a vector picture or a header it cannot read", () => {
    expect(pixelSize(ascii("<svg/>"), "image/svg+xml")).toBeNull();
    expect(pixelSize(bytes(1, 2), "image/png")).toBeNull();
  });
});
