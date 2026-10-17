// What a PNG draws, read without an image library: a scenario asks whether a frame or a thumbnail
// shows the colour its fixture holds, from WebDriver's screenshot or a route's answer. Eight bits
// per channel, not interlaced, greyscale, RGB or RGBA (what WebKit's screenshot and a thumbnail
// write); anything else is refused by name. `solidPng` writes the fixture the reader is held to.

import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

export interface PngPixels {
  width: number;
  height: number;
  pixelAt: (x: number, y: number) => Rgba;
}

// colour type → channels per pixel
const CHANNELS = new Map([
  [0, 1],
  [2, 3],
  [4, 2],
  [6, 4],
]);

// big-endian, as every PNG integer is
const uint32 = (bytes: Uint8Array, at: number): number =>
  Buffer.from(bytes.subarray(at, at + 4)).readUInt32BE(0);

const paeth = (left: number, up: number, upLeft: number): number => {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) {
    return left;
  }
  return toUp <= toUpLeft ? up : upLeft;
};

// each scanline's filter undone in place, over the previous line's reconstructed bytes
const unfilter = (
  inflated: Uint8Array,
  height: number,
  stride: number,
  bpp: number,
): Uint8Array => {
  const out = new Uint8Array(height * stride);
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[row * (stride + 1)] ?? 0;
    const line = inflated.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const at = row * stride;
    for (let index = 0; index < stride; index += 1) {
      const raw = line[index] ?? 0;
      const left = index >= bpp ? (out[at + index - bpp] ?? 0) : 0;
      const up = row > 0 ? (out[at - stride + index] ?? 0) : 0;
      const upLeft = row > 0 && index >= bpp ? (out[at - stride + index - bpp] ?? 0) : 0;
      let value = raw;
      if (filter === 1) {
        value = raw + left;
      } else if (filter === 2) {
        value = raw + up;
      } else if (filter === 3) {
        value = raw + Math.floor((left + up) / 2);
      } else if (filter === 4) {
        value = raw + paeth(left, up, upLeft);
      } else if (filter !== 0) {
        throw new Error(`png: scanline ${String(row)} has unknown filter ${String(filter)}`);
      }
      out[at + index] = value % 256;
    }
  }
  return out;
};

export const readPngPixels = (bytes: Uint8Array): PngPixels => {
  if (!SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error("png: not a PNG signature");
  }
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Uint8Array[] = [];
  for (let at = SIGNATURE.length; at + 8 <= bytes.length;) {
    const length = uint32(bytes, at);
    const type = String.fromCodePoint(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = uint32(body, 0);
      height = uint32(body, 4);
      // depth, colour type, compression, filter method, interlace
      const [depth, colour] = body.subarray(8, 10);
      const interlace = body.at(12);
      channels = CHANNELS.get(colour ?? -1) ?? 0;
      if (depth !== 8 || channels === 0 || interlace !== 0) {
        throw new Error(
          `png: depth ${String(depth)}, colour type ${String(colour)}, interlace ${String(interlace)} is not read here`,
        );
      }
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  if (width === 0 || height === 0) {
    throw new Error("png: no IHDR");
  }
  const stride = width * channels;
  const pixels = unfilter(inflateSync(Buffer.concat(data)), height, stride, channels);
  return {
    height,
    pixelAt: (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        throw new Error(
          `png: (${String(x)}, ${String(y)}) is outside ${String(width)}×${String(height)}`,
        );
      }
      const at = y * stride + x * channels;
      const sample = (offset: number): number => pixels[at + offset] ?? 0;
      if (channels === 1) {
        return [sample(0), sample(0), sample(0), 255];
      }
      if (channels === 2) {
        return [sample(0), sample(0), sample(0), sample(1)];
      }
      return [sample(0), sample(1), sample(2), channels === 4 ? sample(3) : 255];
    },
    width,
  };
};

const chunk = (type: string, body: Uint8Array): Buffer => {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, check]);
};

// an RGBA PNG of one colour, `width` by `height`
export const solidPng = (width: number, height: number, colour: Rgba): Uint8Array => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const line = [0, ...Array.from({ length: width }, () => colour).flat()];
  const raw = Buffer.from(Array.from({ length: height }, () => line).flat());
  return new Uint8Array(
    Buffer.concat([
      SIGNATURE,
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", new Uint8Array(0)),
    ]),
  );
};
