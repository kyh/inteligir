// Deterministic teardown for a pending AI suggestion session (#374).
//
// While suggestions are under review, the save buffer is frozen at the
// pre-session bytes (transient.ts) — any typing the user interleaves rides
// ONLY the live editor value. If the session is abandoned (tab replaced or
// closed, folder switched, an explicit flush), that typing must not vanish
// with the AI marks: the mounted editor registers a settler here, and
// VaultProvider's flushTab invokes it BEFORE flushing — the settler resolves
// the session reject-all (reject reverts only suggestion-marked ranges, so
// the user's typing survives while the AI's proposal disappears) and returns
// the settled markdown for the flush to persist.
//
// Mirrors the open-note-flush seam: the editor owns the implementation, this
// module is just the wire. One rich editor mounts PER OPEN TAB (#369 keeps
// hidden tabs' editors alive), so this is a registry keyed by path — flushing
// one tab settles exactly that tab's editor, never a sibling's.

const settlers = new Map<string, () => string | null>();

/** Wire a mounted editor's settler: `path` is the vault-relative file it
 * serves; `settle` resolves any pending suggestion session (reject-all) and
 * returns the settled markdown, or null when nothing was pending. Returns
 * the unregister function. */
export function registerTransientSettler(path: string, settle: () => string | null): () => void {
  settlers.set(path, settle);
  return () => {
    if (settlers.get(path) === settle) settlers.delete(path);
  };
}

/** Settle the pending AI suggestion session of the editor mounted on `path`,
 * if any. Returns the settled markdown when a session was resolved, else
 * null (no editor on that path, or nothing pending). */
export function settleTransients(path: string): string | null {
  return settlers.get(path)?.() ?? null;
}
