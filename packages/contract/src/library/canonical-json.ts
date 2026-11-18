interface JsonMap {
  readonly [key: string]: JsonValue | undefined;
}

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonMap;

const isJsonMap = (value: JsonValue): value is JsonMap =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const canonicalJson: (value: JsonValue) => string = (value: JsonValue) => {
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

export const sameJson = (a: JsonValue, b: JsonValue) => canonicalJson(a) === canonicalJson(b);

const MAX_ONE_BYTE = 0x7f;
const MAX_TWO_BYTES = 0x7_ff;
const MAX_THREE_BYTES = 0xff_ff;

export const utf8ByteLength = (text: string) => {
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
