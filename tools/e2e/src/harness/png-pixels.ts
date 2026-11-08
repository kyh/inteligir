// A PNG of one colour, written without an image library: the picture fixture a scenario saves,
// imports or drops.

import { crc32, deflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

const chunk = (type: string, body: Uint8Array): Buffer => {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, check]);
};

// an RGBA PNG of one colour, `width` by `height`
export const solidPng = (width: number, height: number, colour: Rgba): Uint8Array<ArrayBuffer> => {
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
