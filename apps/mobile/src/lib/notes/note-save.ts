// ---------------------------------------------------------------------------
// Saving one edited note WITHOUT clobbering a concurrent change to the same
// file. The editor reads a note's bytes when it opens and writes the draft
// back on Save; a sync pass landing a newer version in between is invisible to
// the sync engine — base, local and remote all line up, so the write looks
// like a clean local edit and the pulled version is simply lost.
//
// So the check lives here: re-read at save time and compare against the bytes
// the editor opened. Unchanged → a plain write. Changed → the SAME merge
// ladder the engine runs (@repo/notes/sync/merge/ladder) over
// {openedText, draft, currentDisk}, so the product has ONE merge behaviour;
// and when the ladder refuses, the engine's own answer — a conflict-copy
// sibling — rather than picking a side. Nothing is ever overwritten unseen.
//
// A file that cannot be READ is not a file that is GONE. Absence means the
// draft is the only copy of that text anywhere, so it is written; an
// unreadable file may hold anything, so the draft goes beside it and the note
// itself is left alone. Collapsing the two overwrites content nobody saw.
//
// PURE over an injected `NoteIo` + stamp, so it unit-tests on node; the expo
// wiring is the caller's (the note screen's vault-access read/write).
// ---------------------------------------------------------------------------

import { mergeLadder } from "@repo/notes/sync/merge/ladder";
import { conflictCopyName } from "@repo/notes/sync/reconcile";
import type { VaultPath } from "@repo/notes/sync/vault-file";

/** The vault operations a save needs, all synchronous. */
export type NoteIo = {
  /** Raw file text, or null when it is missing OR unreadable — `exists`
   * separates those two. */
  read: (path: VaultPath) => string | null;
  /** Whether a file is on disk at all, whatever its bytes. */
  exists: (path: VaultPath) => boolean;
  /** Write text, creating parent directories as needed. */
  write: (path: VaultPath, text: string) => void;
};

/** Why the draft went to a sibling copy instead of into the note. */
type ForkCause =
  /** The note changed underneath and no rung of the ladder could fold both. */
  | "unmergeable"
  /** The note is on disk but unreadable, so nothing may be assumed about it. */
  | "unreadable";

export type SaveOutcome =
  /** No concurrent change: the draft is the file. */
  | { readonly kind: "written"; readonly text: string }
  /** The ladder folded both sides together; `text` is what the file now holds. */
  | { readonly kind: "merged"; readonly text: string }
  /** The draft is preserved at `copyPath`; `text` is what the screen should now
   * show at `path` — the concurrent version, or the opened bytes when the file
   * could not be read. */
  | {
      readonly kind: "forked";
      readonly text: string;
      readonly copyPath: VaultPath;
      readonly cause: ForkCause;
    };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function saveNote(input: {
  readonly io: NoteIo;
  readonly path: VaultPath;
  /** The exact text read when the editor opened — the merge BASE. */
  readonly openedText: string;
  readonly draft: string;
  /** Filesystem-safe timestamp for a conflict-copy name (sync/clock.ts). */
  readonly stamp: () => string;
}): SaveOutcome {
  const { io, path, openedText, draft } = input;
  const current = io.read(path);

  if (current === null && io.exists(path)) {
    return fork(input, openedText, "unreadable");
  }

  // A vanished file is recreated from the draft rather than treated as a
  // remote delete to honour: the user's unsaved words are the only copy of
  // that text anywhere, and sync resurrects nothing.
  if (current === null || current === openedText) {
    io.write(path, draft);
    return { kind: "written", text: draft };
  }

  const merged = mergeLadder({
    base: { kind: "bytes", bytes: encoder.encode(openedText) },
    local: encoder.encode(draft),
    remote: encoder.encode(current),
  });
  if (merged.kind === "merged") {
    const text = decoder.decode(merged.bytes);
    io.write(path, text);
    return { kind: "merged", text };
  }

  // The path keeps the side already on disk — the engine's tiebreak, since
  // that side is what the other devices converged on — and the draft is
  // preserved beside it. The note itself is never rewritten here.
  return fork(input, current, "unmergeable");
}

function fork(
  input: { io: NoteIo; path: VaultPath; draft: string; stamp: () => string },
  text: string,
  cause: ForkCause,
): SaveOutcome {
  const copyPath = conflictCopyName(input.path, input.stamp());
  input.io.write(copyPath, input.draft);
  return { kind: "forked", text, copyPath, cause };
}
