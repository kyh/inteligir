// ---------------------------------------------------------------------------
// What a NON-REACT caller may ask about the open note.
//
// The voice transcript path and the agent store both run outside the component
// tree and need three things before a turn: the buffer persisted, which file
// "this note" means, and whether that file is private. This module is the whole
// answer, and it is deliberately thin — everything here reads
// ./open-note-store, which is the open note's ONE home.
//
// Path and privacy are DERIVED from that store rather than republished into
// slots of their own, so they cannot go stale between opens. The flush is an
// ACTION only the live session can perform, so it is held in the store beside
// the state it acts on: a session that ends clears it the same way it clears
// everything else, instead of needing a teardown line that can be forgotten.
// ---------------------------------------------------------------------------

import { notePrivacy } from "@repo/notes/markdown/frontmatter";

import { openNoteState, useOpenNote } from "@repo/editor/note/open-note-store";

// Upper bound on how long a flush may take before callers give up on it. A
// flush is one write to the host; if it somehow never settles, a serialized
// caller (the voice chain) must not wedge forever behind it.
const FLUSH_TIMEOUT_MS = 5000;

/** Wire (or clear, with null) the live session's flush. The session owns the
 * only implementation; nothing else may install one. */
export function setOpenNoteFlush(flush: (() => Promise<boolean>) | null): void {
  useOpenNote.setState({ flush });
}

/** The path of the note currently open in the editor, or null. */
export function openNotePath(): string | null {
  return openNoteState().editor.path;
}

/**
 * Whether the open note is private for AI purposes.
 *
 * FAIL-CLOSED three ways, and all three are load-bearing: indeterminate
 * frontmatter counts as private, no note open counts as private, and NO LIVE
 * SESSION counts as private. The last one is why `flush` is the mount signal
 * rather than incidental — state can outlive the provider that published it,
 * and reading a stale buffer as "public" would attach a path nobody is looking
 * at any more.
 *
 * Reads the live BUFFER rather than the saved file, so a just-typed
 * `private: true` is honored on the very next send. The buffer is the only
 * gate: this is a leak-prevention gesture on the client, not a boundary the
 * host enforces.
 */
export function openNoteIsPrivate(): boolean {
  const { editor, flush } = openNoteState();
  if (flush === null || editor.path === null) return true;
  return notePrivacy(editor.content) !== "public";
}

/** Flush the open note. Resolves true when the buffer is clean afterward (or
 * there's no session / nothing to flush). Never rejects, and always settles
 * within FLUSH_TIMEOUT_MS (resolving false on timeout) so a hung flush can't
 * deadlock a serialized caller. The timer is cleared once the race settles so
 * it never leaks. (JS can't cancel the underlying write; a flush slow enough to
 * time out — a >5s round trip to the host — could still land late, the
 * documented last-write-wins residual. The timeout bounds the caller's wait, it
 * does not abort the write.) */
export function flushOpenNote(): Promise<boolean> {
  const flush = openNoteState().flush;
  if (flush === null) return Promise.resolve(true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), FLUSH_TIMEOUT_MS);
  });
  return Promise.race([flush().catch(() => false), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
