const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const uuidV7 = (now: number, random: Uint8Array) => {
  if (random.length !== 16) {
    throw new RangeError("a UUID takes 16 bytes");
  }

  const bytes = Uint8Array.from(random);
  let time = Math.trunc(now);

  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }

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
