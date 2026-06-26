// VaultEditorController — the open-file editing session for the Vault panel,
// extracted from the React component into a plain, synchronous, unit-testable
// state machine.
//
// Why: the panel accreted a pile of refs (selected/content/dirty/saving/readSeq/
// root) that only synced on render, and every async edge (save-vs-reload,
// open-vs-reload, root switch, delete-vs-save, deleted-elsewhere) needed its own
// guard. Holding the canonical state in instance fields makes those updates
// synchronous — eliminating the render-timing class of bugs — and lets the races
// be tested directly with deferred IO fakes.
//
// The controller owns: root, the open path, its content, dirty, and saving.
// The React component owns pure UI (file list, filter, raw/rich mode) and the
// autosave debounce, calling controller methods and subscribing for renders.

export type VaultIO = {
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
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

  /** Open a file, saving any pending edits to the current one first. Returns
   * false (without switching) when that save failed and the buffer is still
   * dirty, so the caller can surface it rather than silently drop the edits. */
  async open(path: string): Promise<boolean> {
    await this.flush();
    if (this.st.dirty) return false; // save failed — keep the current file open
    const seq = ++this.readSeq;
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

  /** Delete the open file. Waits for any in-flight write (so it can't recreate
   * the file after the delete), then removes and clears the selection. The
   * unsaved buffer is intentionally discarded — that's what deleting means — so
   * dirty is cleared at the end rather than up front, leaving flush's own
   * dirty-bookkeeping intact while it's still running. */
  async remove(): Promise<void> {
    const path = this.st.path;
    if (path === null) return;
    if (this.writing) await this.writing.catch(() => {});
    this.readSeq++; // cancel any in-flight read of this path
    try {
      await this.io.remove(path);
    } catch {
      // Best-effort; clear regardless.
    }
    this.emit({ path: null, content: "", dirty: false });
  }

  /** Drop the open file (e.g. after the component switches folder). */
  clear(): void {
    this.readSeq++;
    this.emit({ path: null, content: "", dirty: false });
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
