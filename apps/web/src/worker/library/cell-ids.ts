// The ids the cell mints itself, from Web Crypto's random bytes
// (https://developers.cloudflare.com/workers/runtime-apis/web-crypto/): an item an agent or a
// save makes is a UUID version 7, as a device's own are, so ids sort by when they were made
// (RFC 9562 § 5.7); a block an import or an edit reads is any unique id the vocabulary takes; a
// highlight's is the annotation modules' own alphabet; a change set's is a random UUID.

import { mintAnnotationId } from "@repo/notes/annotations/store-schema";

export interface CellIds {
  readonly item: () => string;
  readonly block: () => string;
  readonly annotation: () => string;
  readonly changeSet: () => string;
}

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

// 48 bits of unix milliseconds, the version, 74 random bits and the variant
export const uuidV7 = (now: number, random: Uint8Array): string => {
  if (random.length !== 16) {
    throw new RangeError("a UUID takes 16 bytes");
  }
  const bytes = Uint8Array.from(random);
  let time = Math.trunc(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  // the version's high nibble over 4 random bits, the variant's two bits over 6
  bytes[6] = 0x70 + ((bytes[6] ?? 0) % 0x10);
  bytes[8] = 0x80 + ((bytes[8] ?? 0) % 0x40);
  const digits = hex(bytes);
  return [
    digits.slice(0, 8),
    digits.slice(8, 12),
    digits.slice(12, 16),
    digits.slice(16, 20),
    digits.slice(20),
  ].join("-");
};

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

export const cellIds = (now: () => number): CellIds => ({
  annotation: () => mintAnnotationId(randomBytes),
  block: () => crypto.randomUUID(),
  changeSet: () => crypto.randomUUID(),
  item: () => uuidV7(now(), randomBytes(16)),
});
