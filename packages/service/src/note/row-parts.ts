// A Durable Object's SQLite refuses a row past 2 MB, and a note's whole state is one update, so
// its snapshot and each update of a turn's log are kept as parts of 1 MiB, joined as they are read.

const PART_BYTES = 1024 * 1024;

export const partsOf = (bytes: Uint8Array): Uint8Array[] =>
  Array.from({ length: Math.max(1, Math.ceil(bytes.length / PART_BYTES)) }, (_, part) =>
    bytes.slice(part * PART_BYTES, (part + 1) * PART_BYTES),
  );

export const joined = (parts: readonly Uint8Array[]): Uint8Array => {
  const whole = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.length;
  }
  return whole;
};
