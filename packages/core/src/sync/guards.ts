/**
 * True for a non-null, non-array object — narrows `unknown` before indexing its
 * keys. Used by the wire boundary parsers (never trust a network payload). Kept
 * local to @repo/core so the pure package needs no cross-package import.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
