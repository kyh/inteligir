// One spelling of a JSON value, so equal values hash and compare equal on every host: object keys
// sorted by code unit at every depth, undefined members left out, as JSON.stringify leaves them.

export interface JsonMap {
  readonly [key: string]: JsonValue | undefined;
}

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonMap;

const isJsonMap = (value: JsonValue): value is JsonMap =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const canonicalJson = (value: JsonValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (!isJsonMap(value)) {
    return JSON.stringify(value);
  }
  const members: string[] = [];
  for (const key of Object.keys(value).toSorted()) {
    const member = value[key];
    if (member !== undefined) {
      members.push(`${JSON.stringify(key)}:${canonicalJson(member)}`);
    }
  }
  return `{${members.join(",")}}`;
};

export const sameJson = (a: JsonValue, b: JsonValue): boolean =>
  canonicalJson(a) === canonicalJson(b);

const MAX_ONE_BYTE = 0x7f;
const MAX_TWO_BYTES = 0x7_ff;
const MAX_THREE_BYTES = 0xff_ff;

// the bytes a string takes as UTF-8, which is what a storage cap counts; a lone surrogate is the
// three bytes of the replacement character it encodes as
export const utf8ByteLength = (text: string): number => {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    if (point <= MAX_ONE_BYTE) {
      bytes += 1;
    } else if (point <= MAX_TWO_BYTES) {
      bytes += 2;
    } else if (point <= MAX_THREE_BYTES) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
};
