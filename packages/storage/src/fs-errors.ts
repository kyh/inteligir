/** Whether `err` is a node fs error carrying code ENOENT (no such file) —
 * the one error class callers treat as a legitimate "absent" rather than a
 * failure (privacy probes read it as `absent`; checkpoint capture as a
 * pre-write state). */
export function isEnoent(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

// Two deliberate one-line copies so storage stays a LEAF package (dep DAG,
// CLAUDE.md): the canonical isRecord lives in @repo/notes/sync/guards (re-
// exported by @repo/bridge/wire-helpers) — a workspace edge for two
// one-liners isn't worth un-leafing the substrate.

/** True for a non-null, non-array object — narrows `unknown` before indexing
 * its keys (json-store's raw-parse boundary). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Human-readable message for a caught value; a non-Error throw stringifies. */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
