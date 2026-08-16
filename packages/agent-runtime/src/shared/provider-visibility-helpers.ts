// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

export interface StringRecord {
  [key: string]: unknown;
}

export function isRecord(value: unknown): value is StringRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getRecordProperty(value: StringRecord, key: string): StringRecord | null {
  const next = value[key];
  return isRecord(next) ? next : null;
}

export function getStringProperty(value: StringRecord, key: string): string | undefined {
  const next = value[key];
  return typeof next === "string" ? next : undefined;
}
