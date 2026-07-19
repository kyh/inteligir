/**
 * True for a non-null, non-array object — narrows `unknown` before indexing its
 * keys. Used by the wire boundary parsers (never trust a network payload). The
 * single definition app-wide: @repo/features/ipc re-exports it for the IPC
 * seam's consumers.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
