// ---------------------------------------------------------------------------
// classify-file-change — the open-note watcher's brain (vault liveness —
// CLAUDE.md § Decisions). The
// ephemeral listing has exactly ONE filesystem watcher: a non-recursive watch on
// the currently open note. When it fires we must decide, from disk state
// alone, whether the editor needs to react — and crucially NOT react to the
// app's own autosaves (which today round-trip a pointless broadcast per save).
//
// Two cooperating pieces, both pure/host-testable:
//   - `classifyFileChange` — a pure verdict over (last-known fingerprint,
//     current disk fingerprint, editor-dirty) → none | reload | conflict |
//     match. Models the FULL space so it can be tested exhaustively; the host
//     currently maps both `reload` and `conflict` to "broadcast onVaultChanged"
//     (the renderer's existing external-change machinery resolves the dirty vs
//     clean case), and treats `none`/`match` as "ignore".
//   - `SelfSaveRegistry` — records app-initiated writes by (path, mtimeMs) with
//     a short TTL, so the watch event a self-save necessarily produces is
//     filtered out before it ever reaches the classifier. Only the editor's own
//     write path records here; restore / sync-pull / external edits do NOT, so
//     those still surface as reloads.
// ---------------------------------------------------------------------------

/** The four possible outcomes of an open-note watch event.
 *  - `match`   — disk fingerprint equals what we last knew: nothing changed
 *                (a duplicate/metadata-only event, or our own write echoing).
 *  - `none`    — no basis to act (file missing/unreadable, or no baseline yet).
 *  - `reload`  — disk changed and the editor is clean: re-read the buffer.
 *  - `conflict`— disk changed AND the editor has unsaved edits. */
export type FileChangeVerdict = "match" | "none" | "reload" | "conflict";

export type ClassifyInput = {
  /** Fingerprint of the watched file the last time we observed it (`mtimeMs:size`
   * from `statFingerprint`, or a content hash), or null if we have no baseline. */
  lastKnown: string | null;
  /** Current on-disk fingerprint, or null when the file is missing/unreadable. */
  current: string | null;
  /** Whether the editor has unsaved edits to the watched note. */
  editorDirty: boolean;
};

/** Pure verdict — see FileChangeVerdict. Deliberately total over its inputs so
 * the unit tests can enumerate every combination. */
export function classifyFileChange({
  lastKnown,
  current,
  editorDirty,
}: ClassifyInput): FileChangeVerdict {
  // File gone/unreadable — a vanish is handled by the watcher (it broadcasts and
  // the renderer's vanish watcher closes the note); nothing to classify here.
  if (current === null) return "none";
  // No baseline to diff against — don't guess a change.
  if (lastKnown === null) return "none";
  // Disk matches what we last saw: our own write landing, or a no-op event.
  if (current === lastKnown) return "match";
  // Disk genuinely changed underneath us.
  return editorDirty ? "conflict" : "reload";
}

/** Age after which a recorded self-save is forgotten. Generous relative to the
 * gap between a write and the watch event it triggers (sub-second in practice);
 * long enough that a slow FSEvents delivery still matches, short enough that a
 * stale entry can't mask a genuine later external edit at the same mtime. */
const SELF_SAVE_TTL_MS = 5_000;

/** Records the app's own writes so the watch event they produce can be filtered
 * out. Keyed by vault-relative path → the mtimeMs we wrote; a genuine external
 * edit lands a different mtime and so is NOT matched. Entries expire by age.
 *
 * Only the editor write path (writeVaultDoc) records here. Restore, sync-pull,
 * and external tools do not, so their writes still surface as reloads. */
export class SelfSaveRegistry {
  private readonly entries = new Map<string, { mtimeMs: number; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Record that the app just wrote `path`, landing it at `mtimeMs`. */
  record(path: string, mtimeMs: number): void {
    this.entries.set(path, { mtimeMs, expiresAt: this.now() + SELF_SAVE_TTL_MS });
    this.prune();
  }

  /** True when a watch event for `path` at `mtimeMs` corresponds to a recent
   * app-initiated write (and should therefore be ignored). Not one-shot: a
   * single write can produce several watch events (tmp-rename + change), all of
   * which carry the same mtime and must all be filtered. */
  isSelfSave(path: string, mtimeMs: number): boolean {
    const entry = this.entries.get(path);
    if (entry === undefined) return false;
    if (this.now() > entry.expiresAt) {
      this.entries.delete(path);
      return false;
    }
    return entry.mtimeMs === mtimeMs;
  }

  /** Drop the record for a path (e.g. when it stops being the watched note). */
  forget(path: string): void {
    this.entries.delete(path);
  }

  private prune(): void {
    const now = this.now();
    for (const [path, entry] of this.entries) {
      if (now > entry.expiresAt) this.entries.delete(path);
    }
  }
}
