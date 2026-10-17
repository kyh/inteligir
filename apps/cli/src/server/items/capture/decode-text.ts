// a page's bytes as text, by the HTML standard's order: a byte-order mark, then the response's
// declared charset, then a `<meta charset>` (or its http-equiv spelling) in the first 1024 bytes,
// then UTF-8. A label the platform's decoder does not know falls through to the next source, and
// no source ever throws: a page's bytes are hostile input.

import { TextDecoder } from "node:util";

const PRESCAN_BYTES = 1024;

const BOMS: readonly { bytes: readonly number[]; label: string }[] = [
  { bytes: [0xef, 0xbb, 0xbf], label: "utf-8" },
  { bytes: [0xfe, 0xff], label: "utf-16be" },
  { bytes: [0xff, 0xfe], label: "utf-16le" },
];

const decoderFor = (label: string | null): TextDecoder | null => {
  if (label === null || label.trim() === "") {
    return null;
  }
  try {
    return new TextDecoder(label.trim().toLowerCase());
  } catch {
    return null;
  }
};

const bomLabel = (bytes: Uint8Array): string | null =>
  BOMS.find(({ bytes: mark }) => mark.every((byte, index) => bytes[index] === byte))?.label ?? null;

// the meta prescan reads ASCII, which every charset a page may declare shares in its first bytes
const prescanLabel = (bytes: Uint8Array): string | null => {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, PRESCAN_BYTES));
  const direct = /<meta[^>]+charset\s*=\s*["']?\s*(?<label>[\w.:-]+)/iu.exec(head)?.groups?.label;
  return direct ?? null;
};

// UTF-16 is never honoured from a meta tag (the standard reads it as UTF-8 there), since a tag the
// prescan could read in ASCII cannot be in UTF-16
const fromMeta = (label: string | null): string | null =>
  label === null || /^utf-16/iu.test(label) ? null : label;

export const decodeText = (bytes: Uint8Array, declaredCharset: string | null): string => {
  const bom = bomLabel(bytes);
  if (bom !== null) {
    return new TextDecoder(bom).decode(bytes);
  }
  const decoder =
    decoderFor(declaredCharset) ??
    decoderFor(fromMeta(prescanLabel(bytes))) ??
    new TextDecoder("utf-8");
  return decoder.decode(bytes);
};
