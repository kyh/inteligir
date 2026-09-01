// VaultEditorController — the open note's editing session, held outside React
// as a plain, synchronous, unit-testable state machine.
//
// Why: as component state this would be a pile of refs (selected/content/
// dirty/saving/readSeq/root) that only sync on render, and every async edge
// (save-vs-reload, open-vs-reload, root switch, delete-vs-save,
// deleted-elsewhere) needs its own guard. Holding the canonical state in
// instance fields makes those updates synchronous — eliminating the
// render-timing class of bugs — and lets the races be tested directly with
// deferred IO fakes.
//
// The controller owns: root, the open path, its content, dirty, and saving.
// The note runtime above it owns the autosave debounce and the vanish
// watcher, calling controller methods and subscribing for state.

import type { DeleteVaultEntryResult } from "@repo/editor/host-io";

export type VaultIO = {
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  /** Delete, ANSWERING WITH THE OUTCOME. The host's deletion gate can hold a
   * delete whole — the file stays, on purpose — and a controller that closed
   * the note anyway would report a deletion that did not happen. */
  remove: (path: string) => Promise<DeleteVaultEntryResult>;
};

export type VaultEditorState = {
  /** Vault root currently loaded against ("" until known). */
  readonly root: string;
  /** Open file (vault-relative), or null. */
  readonly path: string | null;
  /** Editor buffer for the open file. */
  readonly content: string;
  /** Unsaved edits pending. */
  readonly dirty: boolean;
  /** A write is in flight. */
  readonly saving: boolean;
};

const EMPTY: VaultEditorState = { root: "", path: null, content: "", dirty: false, saving: false };

export class VaultEditorController {
  private st: VaultEditorState = EMPTY;
  // Monotonic token shared by every read (open + reload): only the latest read
  // applies, so a slow read can't land over a newer one.
  private readSeq = 0;
  // In-flight write, so saves serialize and delete/flush can await it.
  private writing: Promise<void> | null = null;
  private readonly subs = new Set<() => void>();

  constructor(private readonly io: VaultIO) {}

  // Bound so they can be passed straight to useSyncExternalStore.
  readonly getState = (): VaultEditorState => this.st;
  readonly subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  private emit(patch: Partial<VaultEditorState>): void {
    this.st = { ...this.st, ...patch };
    for (const fn of this.subs) fn();
  }

  /** Adopt the known root on mount without disturbing the open file. */
  setRoot(root: string): void {
    if (root !== this.st.root) this.emit({ root });
  }

  /**
   * Handle a vault-changed broadcast. A real root switch (a different non-empty
   * root than the one loaded) drops the open file — its relative path belongs to
   * the old vault. The empty sentinel before the root is first known is NOT a
   * switch, so the user's own first autosave broadcast can't wipe their edits.
   * Otherwise reload the open file if it's safe to.
   */
  externalChange(nextRoot: string): void {
    const rootChanged = this.st.root !== "" && nextRoot !== this.st.root;
    if (rootChanged) {
      this.readSeq++; // cancel in-flight reads against the old root
      this.st = { ...EMPTY, root: nextRoot };
      for (const fn of this.subs) fn();
      return;
    }
    if (nextRoot !== this.st.root) this.emit({ root: nextRoot });
    void this.reloadOpen();
  }

  /**
   * Open a file, saving any pending edits to the current one first. Returns
   * false (without switching) when that save failed and the buffer is still
   * dirty, so the caller can surface it rather than silently drop the edits.
   *
   * `initial` is the file's bytes when the caller already holds them — the
   * workspace's boot bundle carries the open note's text, which is what keeps a
   * cold open from paying a second round trip for what it was just sent.
   */
  async open(path: string, initial?: string): Promise<boolean> {
    await this.flush();
    if (this.st.dirty) return false; // save failed — keep the current file open
    const seq = ++this.readSeq;
    if (initial !== undefined) {
      this.emit({ path, content: initial, dirty: false });
      return true;
    }
    try {
      const text = await this.io.read(path);
      if (this.readSeq !== seq) return true; // a newer read (open or reload) won
      this.emit({ path, content: text, dirty: false });
    } catch {
      if (this.readSeq !== seq) return true;
      // Unreadable (e.g. deleted between click and read) — don't revive it as an
      // empty buffer; leave nothing selected.
      this.emit({ path: null, content: "", dirty: false });
    }
    return true;
  }

  /** Record an edit to the open buffer. The component debounces flush(). */
  edit(content: string): void {
    if (this.st.path === null) return;
    this.emit({ content, dirty: true });
  }

  /** Persist the open buffer. Serializes behind any in-flight write; clears
   * dirty only after the write lands and only if the buffer still matches what
   * was written (so an edit during the write keeps dirty set for the next pass). */
  async flush(): Promise<void> {
    if (this.writing) await this.writing.catch(() => {});
    const path = this.st.path;
    if (path === null || !this.st.dirty) return;
    const snapshot = this.st.content;
    this.emit({ saving: true });
    const writing = this.io.write(path, snapshot).then(
      () => {
        if (this.st.path === path && this.st.content === snapshot) {
          this.emit({ dirty: false, saving: false });
        } else {
          this.emit({ saving: false }); // newer edit or file switched — stay dirty
        }
        return undefined;
      },
      () => {
        this.emit({ saving: false }); // leave dirty set so a later flush retries
        return undefined;
      },
    );
    this.writing = writing;
    await writing;
    if (this.writing === writing) this.writing = null;
  }

  /**
   * Delete the open file. Waits for any in-flight write (so it can't recreate
   * the file after the delete), then removes and — ONLY IF THE FILE ACTUALLY
   * WENT — clears the selection. The unsaved buffer is intentionally discarded
   * when it does — that's what deleting means — so dirty is cleared at the end
   * rather than up front, leaving flush's own dirty-bookkeeping intact while
   * it's still running.
   *
   * The outcome is RETURNED rather than swallowed. A held delete (the host's
   * deletion gate) and a failed one both leave the file on disk, and closing
   * the note over either would tell the user the file is gone while it is
   * still there — the one report a delete must never make. The caller surfaces
   * what happened; `null` is a delete that threw, which is neither outcome.
   */
  async remove(): Promise<DeleteVaultEntryResult | null> {
    const path = this.st.path;
    if (path === null) return null;
    if (this.writing) await this.writing.catch(() => {});
    this.readSeq++; // cancel any in-flight read of this path
    let outcome: DeleteVaultEntryResult | null = null;
    try {
      outcome = await this.io.remove(path);
    } catch {
      // Answered as `null` — the file's fate is unknown, so the note stays.
    }
    if (outcome !== null && outcome.outcome !== "held") {
      this.emit({ path: null, content: "", dirty: false });
    }
    return outcome;
  }

  private async reloadOpen(): Promise<void> {
    const path = this.st.path;
    // Never reload over unsaved edits or under an in-flight save.
    if (path === null || this.st.dirty || this.writing) return;
    const seq = ++this.readSeq;
    try {
      const text = await this.io.read(path);
      if (this.readSeq !== seq) return;
      if (this.st.path === path && !this.st.dirty && !this.writing) {
        this.emit({ content: text });
      }
    } catch {
      if (this.readSeq !== seq) return;
      // Gone (deleted elsewhere) — drop the now-stale selection.
      if (this.st.path === path && !this.st.dirty) {
        this.emit({ path: null, content: "", dirty: false });
      }
    }
  }
}
