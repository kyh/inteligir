// Reading JSON-shaped data this package did not type: generated files on disk
// and the untyped rows better-sqlite3 hands back. A field is established
// before it is read rather than assumed.

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export function isText(value: JsonValue | undefined): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

export function isNumber(value: JsonValue | undefined): value is number {
  return Number.isFinite(value);
}

export function asMapping(value: JsonValue | undefined): JsonObject | null {
  if (value === null || value === undefined || Array.isArray(value)) return null;
  return value instanceof Object ? value : null;
}
