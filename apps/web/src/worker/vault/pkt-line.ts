import { concatBytes } from "./git-objects";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const FLUSH_PKT = encoder.encode("0000");

export const pktLine = (text: string): Uint8Array => {
  const payload = encoder.encode(text);
  const length = (payload.length + 4).toString(16).padStart(4, "0");
  return concatBytes([encoder.encode(length), payload]);
};

const PKT_LENGTH = /^[0-9a-f]{4}$/iu;

// the lines up to the flush; null when a frame is malformed or no flush ends them
export const readPktLines = (bytes: Uint8Array): string[] | null => {
  const lines: string[] = [];
  let at = 0;
  while (at + 4 <= bytes.length) {
    const prefix = decoder.decode(bytes.subarray(at, at + 4));
    if (!PKT_LENGTH.test(prefix)) {
      return null;
    }
    const length = Number.parseInt(prefix, 16);
    if (length === 0) {
      return lines;
    }
    if (length < 4 || at + length > bytes.length) {
      return null;
    }
    lines.push(decoder.decode(bytes.subarray(at + 4, at + length)).replace(/\n$/u, ""));
    at += length;
  }
  return null;
};
