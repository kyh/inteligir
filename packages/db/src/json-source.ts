export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export const isText = (value: JsonValue | undefined): value is string =>
  Object.prototype.toString.call(value) === "[object String]";

export const isNumber = (value: JsonValue | undefined): value is number => Number.isFinite(value);

export const isMapping = (value: unknown): value is JsonObject =>
  value instanceof Object && !Array.isArray(value);

export const asMapping = (value: JsonValue | undefined): JsonObject | null => {
  if (value === null || value === undefined || Array.isArray(value)) {
    return null;
  }
  return value instanceof Object ? value : null;
};
