import { concatBytes } from "./git-objects";

const encoder = new TextEncoder();

export const FLUSH_PKT = encoder.encode("0000");

export const pktLine = (text: string): Uint8Array => {
  const payload = encoder.encode(text);
  const length = (payload.length + 4).toString(16).padStart(4, "0");
  return concatBytes([encoder.encode(length), payload]);
};
