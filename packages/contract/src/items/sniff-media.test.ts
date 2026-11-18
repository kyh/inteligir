import { describe, expect, it } from "vitest";

import { heifOf, pngOf } from "../test-support/picture-heads.test-utils";
import { pixelSize, sniffMedia } from "./sniff-media";

const bytes = (...values: number[]) => new Uint8Array(values) satisfies Uint8Array;

const ascii = (text: string) => new TextEncoder().encode(text);

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

  it("reads an AVIF's and a HEIC's size from its item properties, a grid's as its whole picture", () => {
    expect(pixelSize(heifOf("avif", [[1, 1]]), "image/avif")).toStrictEqual({
      height: 1,
      width: 1,
    });

    const grid = heifOf("heic", [
      [512, 512],
      [4032, 3024],
      [320, 240],
    ]);

    expect(pixelSize(grid, "image/heic")).toStrictEqual({ height: 3024, width: 4032 });
  });

  it("reads a HEIF's head alone, wherever its sizes sit", () => {
    expect(pixelSize(heifOf("avif", [[640, 400]], 64 * 1024), "image/avif")).toBeNull();
  });

  it("answers null for a vector picture or a header it cannot read", () => {
    expect(pixelSize(ascii("<svg/>"), "image/svg+xml")).toBeNull();
    expect(pixelSize(bytes(1, 2), "image/png")).toBeNull();
    expect(pixelSize(ascii("\u0000\u0000\u0000\u0018ftypavif"), "image/avif")).toBeNull();
  });
});
