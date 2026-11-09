// A UUID version 7 (RFC 9562 § 5.7): 48 bits of unix milliseconds, the version, 74 random bits and
// the variant, so ids sort by when they were made. The one spelling every writer mints an item's,
// a folder's and an op's id by, the cell and each device alike; the caller hands the time and 16
// random bytes, so this module reads no clock and no `crypto` global.

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

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
