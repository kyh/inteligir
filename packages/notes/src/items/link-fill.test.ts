// how a device judges what it read of a link: a cover candidate by the picture its bytes are and
// its size, a page by the text its address is kept for, and a reading by who reads after it

import { describe, expect, it } from "vitest";

import {
  coverPicture,
  deviceKeepsReading,
  fillKeepsReading,
  FILL_LIMITS,
  isPage,
  preferredText,
} from "./link-fill";

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
    expect(coverPicture(pngOf(1200, 630))).toStrictEqual({ mime: "image/png" });
    expect(coverPicture(pngOf(FILL_LIMITS.coverMinEdge - 1, 64))).toBeNull();
    expect(coverPicture(new TextEncoder().encode("<html>not a picture</html>"))).toBeNull();
  });

  it("is no cover when its header names more pixels than a device may decode, however small the file", () => {
    const edge = Math.floor(Math.sqrt(FILL_LIMITS.coverMaxPixels));
    expect(coverPicture(pngOf(edge, edge))).toStrictEqual({ mime: "image/png" });
    expect(coverPicture(pngOf(edge + 1, edge + 1))).toBeNull();
    expect(coverPicture(pngOf(30_000, 30_000))).toBeNull();
  });
});

describe("an answer", () => {
  const html = new TextEncoder().encode("<!doctype html><p>a page</p>");
  const pdf = new TextEncoder().encode("%PDF-1.7\n");

  it("is a page by the type it declared, and none reads as one", () => {
    expect(isPage({ bytes: html, mediaType: "text/html" })).toBe(true);
    expect(isPage({ bytes: html, mediaType: "application/xhtml+xml" })).toBe(true);
    expect(isPage({ bytes: html, mediaType: null })).toBe(true);
    expect(isPage({ bytes: html, mediaType: "application/json" })).toBe(false);
  });

  it("is a file when its first bytes say so, whatever it was served as", () => {
    expect(isPage({ bytes: pdf, mediaType: null })).toBe(false);
    expect(isPage({ bytes: pdf, mediaType: "text/html" })).toBe(false);
    expect(isPage({ bytes: pngOf(1200, 630), mediaType: "text/html" })).toBe(false);
  });
});

describe("a page's text", () => {
  it("is its description at a video's or a song's address, and its article at any other", () => {
    expect(preferredText("https://www.youtube.com/watch?v=abc123")).toBe("description");
    expect(preferredText("https://open.spotify.com/track/abc123")).toBe("description");
    expect(preferredText("https://stephango.com/file-over-app")).toBe("article");
  });
});

describe("a reading", () => {
  const facts = { description: null, title: null };

  it("with an article is kept by every reader", () => {
    expect(deviceKeepsReading(["a block"])).toBe(true);
    expect(fillKeepsReading({ facts, rung: "rich" })).toBe(true);
  });

  it("of a page that only named itself goes from a device to the fill, which keeps it", () => {
    expect(deviceKeepsReading([])).toBe(false);
    expect(fillKeepsReading({ facts: { ...facts, title: "A shell" }, rung: null })).toBe(true);
    expect(fillKeepsReading({ facts: { ...facts, description: "A shell" }, rung: null })).toBe(
      true,
    );
  });

  it("of a page that settled no text and named itself nowhere is kept by nothing", () => {
    expect(fillKeepsReading({ facts, rung: null })).toBe(false);
  });
});
