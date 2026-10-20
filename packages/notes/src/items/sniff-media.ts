// what a fetched file is, by its first bytes rather than what the site claims, and how big a picture
// is, read from its header without decoding it. A cover under 200 px is a tracking pixel or an icon,
// never a picture of the page.

export type SniffedMedia =
  | {
      kind: "image";
      mediaType:
        | "image/jpeg"
        | "image/png"
        | "image/gif"
        | "image/webp"
        | "image/svg+xml"
        | "image/avif"
        | "image/heic";
    }
  | { kind: "pdf"; mediaType: "application/pdf" };

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean =>
  signature.every((byte, index) => bytes[at + index] === byte);

const ascii = (bytes: Uint8Array, from: number, to: number): string =>
  String.fromCodePoint(...bytes.subarray(from, to));

const SVG_SNIFF_BYTES = 1024;

// an svg names itself in its first kilobyte, after an optional BOM, declaration and comments
const looksLikeSvg = (bytes: Uint8Array): boolean => {
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, SVG_SNIFF_BYTES)).toLowerCase();
  return /^(?:﻿)?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*|<!doctype[^>]*>\s*)*<svg[\s>]/u.test(
    head,
  );
};

export const sniffMedia = (bytes: Uint8Array): SniffedMedia | null => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { kind: "image", mediaType: "image/jpeg" };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: "image", mediaType: "image/png" };
  }
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return { kind: "image", mediaType: "image/gif" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return { kind: "image", mediaType: "image/webp" };
  }
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (brand === "avif" || brand === "avis") {
      return { kind: "image", mediaType: "image/avif" };
    }
    if (["heic", "heix", "mif1", "msf1"].includes(brand)) {
      return { kind: "image", mediaType: "image/heic" };
    }
  }
  if (ascii(bytes, 0, 5) === "%PDF-") {
    return { kind: "pdf", mediaType: "application/pdf" };
  }
  return looksLikeSvg(bytes) ? { kind: "image", mediaType: "image/svg+xml" } : null;
};

export interface PixelSize {
  width: number;
  height: number;
}

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const pngSize = (bytes: Uint8Array): PixelSize | null =>
  bytes.byteLength < 24
    ? null
    : { height: view(bytes).getUint32(20), width: view(bytes).getUint32(16) };

const gifSize = (bytes: Uint8Array): PixelSize | null =>
  bytes.byteLength < 10
    ? null
    : { height: view(bytes).getUint16(8, true), width: view(bytes).getUint16(6, true) };

const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const jpegSize = (bytes: Uint8Array): PixelSize | null => {
  const data = view(bytes);
  let at = 2;
  while (at + 9 < bytes.byteLength) {
    if (bytes[at] !== 0xff) {
      return null;
    }
    const marker = bytes[at + 1] ?? 0;
    if (JPEG_SOF.has(marker)) {
      return { height: data.getUint16(at + 5), width: data.getUint16(at + 7) };
    }
    at += 2 + data.getUint16(at + 2);
  }
  return null;
};

// little-endian unsigned integer of `count` bytes at `at`
const uintLE = (bytes: Uint8Array, at: number, count: number): number =>
  Array.from({ length: count }, (_, index) => bytes[at + index] ?? 0).reduceRight(
    (total, byte) => total * 256 + byte,
    0,
  );

const FOURTEEN_BITS = 2 ** 14;

const webpSize = (bytes: Uint8Array): PixelSize | null => {
  if (bytes.byteLength < 30) {
    return null;
  }
  const chunk = ascii(bytes, 12, 16);
  if (chunk === "VP8 ") {
    return {
      height: uintLE(bytes, 28, 2) % FOURTEEN_BITS,
      width: uintLE(bytes, 26, 2) % FOURTEEN_BITS,
    };
  }
  if (chunk === "VP8L") {
    const bits = uintLE(bytes, 21, 4);
    return {
      height: (Math.floor(bits / FOURTEEN_BITS) % FOURTEEN_BITS) + 1,
      width: (bits % FOURTEEN_BITS) + 1,
    };
  }
  if (chunk === "VP8X") {
    return { height: uintLE(bytes, 27, 3) + 1, width: uintLE(bytes, 24, 3) + 1 };
  }
  return null;
};

// null for a vector picture, or a header this cannot read
export const pixelSize = (bytes: Uint8Array, mediaType: string): PixelSize | null => {
  switch (mediaType) {
    case "image/png": {
      return pngSize(bytes);
    }
    case "image/gif": {
      return gifSize(bytes);
    }
    case "image/jpeg": {
      return jpegSize(bytes);
    }
    case "image/webp": {
      return webpSize(bytes);
    }
    default: {
      return null;
    }
  }
};
