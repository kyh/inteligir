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
