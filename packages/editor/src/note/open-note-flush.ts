// non-react callers (voice, the agent store) flush the open note through this
// module; a live store registers itself, so a torn-down session is one nothing can flush.

import type { OpenNoteStore } from "@repo/editor/note/open-note-store";

// a flush is one host write; a serialized caller (the voice chain) must not wedge
// forever behind one that never settles.
const FLUSH_TIMEOUT_MS = 5000;

const liveStores = new Set<OpenNoteStore>();

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

// never rejects. the timeout bounds the caller's wait and does not abort the
// write, so a flush slow enough to time out can still land late.
export async function flushOpenNote(): Promise<boolean> {
  const verdicts = await Promise.all([...liveStores].map(flushStore));
  return verdicts.every(Boolean);
}
