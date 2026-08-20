// Reading generated JSON from disk. These files are data, so a field is
// established before it is read rather than assumed.

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export function parseJsonSource(raw: string): JsonValue {
  const value: JsonValue = JSON.parse(raw);
  return value;
}

export function isText(value: JsonValue | undefined): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

export function asMapping(value: JsonValue | undefined): JsonObject | null {
  if (value === null || value === undefined || Array.isArray(value)) return null;
  return value instanceof Object ? value : null;
}
