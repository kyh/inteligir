import { describe, expect, it } from "vitest";

import { failureOf, fileOnlyLinked } from "../fill-sentences";
import { youTubeStills } from "../oembed";
import { pixelSize, sniffMedia } from "../sniff-media";
import { pngOf } from "./capture-harness";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("sniffMedia", () => {
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

describe("pixelSize", () => {
  it("reads a picture's size from its header", () => {
    expect(pixelSize(pngOf(640, 400), "image/png")).toEqual({ height: 400, width: 640 });
    const gif = new Uint8Array([...ascii("GIF89a"), 0x40, 0x01, 0xc8, 0x00]);
    expect(pixelSize(gif, "image/gif")).toEqual({ height: 200, width: 320 });
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x58, 0x03);
    expect(pixelSize(jpeg, "image/jpeg")).toEqual({ height: 400, width: 600 });
  });

  it("answers null for a vector picture or a header it cannot read", () => {
    expect(pixelSize(ascii("<svg/>"), "image/svg+xml")).toBeNull();
    expect(pixelSize(bytes(1, 2), "image/png")).toBeNull();
  });
});

describe("the fill's sentences", () => {
  it("says each failure the way the item's file does", () => {
    expect(failureOf({ kind: "refused", refusal: "this-mac" }).sentence).toBe(
      "This address is on this Mac, so its page isn't read.",
    );
    expect(failureOf({ kind: "refused", refusal: "private-from-public" }).sentence).toBe(
      "The page pointed at an address on your own network, so it isn't read.",
    );
    expect(
      failureOf({ kind: "status", reason: "not found", status: 404, transient: false }),
    ).toEqual({
      sentence: "The site answered 404 (not found).",
      transient: false,
    });
    expect(failureOf({ kind: "timeout" })).toEqual({
      sentence: "The page took too long to answer.",
      transient: true,
    });
    expect(fileOnlyLinked(24 * 1024 * 1024)).toBe(
      "The file is 24 MB; only its link is kept (the limit is 10 MB).",
    );
    // a size that rounds to the limit, or none at all, is never said as the limit itself
    expect(fileOnlyLinked(10 * 1024 * 1024 + 1)).toBe(
      "The file is over 10 MB; only its link is kept.",
    );
    expect(fileOnlyLinked(null)).toBe("The file is over 10 MB; only its link is kept.");
  });
});

describe("youTubeStills", () => {
  it("names a video's own still frames, best first", () => {
    expect(youTubeStills("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual([
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    ]);
    expect(youTubeStills("https://youtu.be/dQw4w9WgXcQ")).toHaveLength(2);
    expect(youTubeStills("https://example.com/watch?v=dQw4w9WgXcQ")).toEqual([]);
  });
});
