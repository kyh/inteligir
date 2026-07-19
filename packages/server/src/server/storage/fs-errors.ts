/** Whether `err` is a node fs error carrying code ENOENT (no such file) —
 * the one error class callers treat as a legitimate "absent" rather than a
 * failure (privacy probes read it as `absent`; checkpoint capture as a
 * pre-write state). */
export function isEnoent(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}
