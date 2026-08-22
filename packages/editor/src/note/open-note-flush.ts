// ---------------------------------------------------------------------------
// What a NON-REACT caller may ask about the open note(s).
//
// The voice transcript path and the agent store both run outside the component
// tree and need the buffer persisted before a turn. With the split view the
// open note is PLURAL (#595), so "flush the open note" means every live pane:
// a caller about to read files must not race ANY dirty buffer, whichever pane
// holds it. Panes register their stores here on mount; the flush action itself
// still lives IN each store, installed by the session that owns it, so a
// session ending clears it with everything else.
// ---------------------------------------------------------------------------

import type { OpenNoteStore } from "@repo/editor/note/open-note-store";

// Upper bound on how long a flush may take before callers give up on it. A
// flush is one write to the host; if it somehow never settles, a serialized
// caller (the voice chain) must not wedge forever behind it.
const FLUSH_TIMEOUT_MS = 5000;

const liveStores = new Set<OpenNoteStore>();

/** Register a pane's store for the module-level flush (returns unregister).
 * Insertion-ordered; the flush visits every live pane. */
export function registerOpenNoteStore(store: OpenNoteStore): () => void {
  liveStores.add(store);
  return () => {
    liveStores.delete(store);
  };
}

function flushStore(store: OpenNoteStore): Promise<boolean> {
  const flush = store.state().flush;
  if (flush === null) return Promise.resolve(true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), FLUSH_TIMEOUT_MS);
  });
  return Promise.race([flush().catch(() => false), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Flush every live pane. Resolves true when every buffer is clean afterward
 * (or no session is mounted). Never rejects, and each pane's wait is bounded
 * by FLUSH_TIMEOUT_MS (false on timeout) so a hung flush can't deadlock a
 * serialized caller. (JS can't cancel the underlying write; a flush slow
 * enough to time out could still land late — the documented last-write-wins
 * residual. The timeout bounds the caller's wait, it does not abort the
 * write.) */
export async function flushOpenNote(): Promise<boolean> {
  const verdicts = await Promise.all([...liveStores].map(flushStore));
  return verdicts.every(Boolean);
}
