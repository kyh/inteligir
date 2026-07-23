// Deterministic teardown for a pending AI suggestion session (#374).
//
// While suggestions are under review, the save buffer is frozen at the
// pre-session bytes (transient.ts) — any typing the user interleaves rides
// ONLY the live editor value. If the session is abandoned (note switched or
// closed, folder switched, an explicit flush), that typing must not vanish
// with the AI marks: the mounted editor registers a settler here, and
// VaultProvider's flushCurrent invokes it BEFORE the runtime flush that
// precedes every save/rename/close — the settler resolves the session
// reject-all (reject reverts only suggestion-marked ranges, so the user's
// typing survives while the AI's proposal disappears) and returns the
// settled markdown for the flush to persist.
//
// Mirrors the open-note-flush seam: the editor owns the implementation, this
// module is just the wire. The registry stays keyed by path because
// unregister/settle can interleave across a note switch (see the
// stale-unregister test) — a settle routed to one path resolves exactly that
// path's editor, never another's.

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
