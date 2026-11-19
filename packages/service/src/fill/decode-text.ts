const PRESCAN_BYTES = 1024;

const BOMS: readonly { bytes: readonly number[]; label: string }[] = [
  { bytes: [0xef, 0xbb, 0xbf], label: "utf-8" },
  { bytes: [0xfe, 0xff], label: "utf-16be" },
  { bytes: [0xff, 0xfe], label: "utf-16le" },
];

const decoderFor = (label: string | null) => {
  if (label === null || label.trim() === "") {
    return null;
  }

  try {
    return new TextDecoder(label.trim().toLowerCase()) satisfies TextDecoder | null;
  } catch {
    return null;
  }
};

const bomLabel = (bytes: Uint8Array) =>
  BOMS.find(({ bytes: mark }) => mark.every((byte, index) => bytes[index] === byte))?.label ?? null;

const prescanLabel = (bytes: Uint8Array) => {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, PRESCAN_BYTES));
  const direct = /<meta[^>]+charset\s*=\s*["']?\s*(?<label>[\w.:-]+)/iu.exec(head)?.groups?.label;

  return direct ?? null;
};

const fromMeta = (label: string | null) =>
  label === null || /^utf-16/iu.test(label) ? null : label;

export const decodeText = (bytes: Uint8Array, declaredCharset: string | null) => {
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
