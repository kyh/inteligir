// held outside React: every async edge (save-vs-reload, open-vs-reload, root switch,
// delete-vs-save) needs a guard that reads and writes in one tick, which render-timed refs
// cannot give.

import type { DeleteVaultEntryResult } from "@repo/editor/host-io";

export type VaultIO = {
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  // answers the outcome: the host can hold a delete, and closing the note anyway would report
  // a deletion that did not happen.
  remove: (path: string) => Promise<DeleteVaultEntryResult>;
};

export type VaultEditorState = {
  readonly root: string;
  readonly path: string | null;
  readonly content: string;
  readonly dirty: boolean;
  readonly saving: boolean;
};

const EMPTY: VaultEditorState = { root: "", path: null, content: "", dirty: false, saving: false };

export class VaultEditorController {
  private st: VaultEditorState = EMPTY;
  // only the latest read applies, so a slow read can't land over a newer one.
  private readSeq = 0;
  private writing: Promise<void> | null = null;
  private readonly subs = new Set<() => void>();

  constructor(private readonly io: VaultIO) {}

  // bound so they can be passed straight to useSyncExternalStore.
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

  setRoot(root: string): void {
    if (root !== this.st.root) this.emit({ root });
  }

  // the empty sentinel before the root is first known is not a switch, or the user's own first
  // autosave broadcast would wipe their edits.
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
      // unreadable (deleted between click and read): don't revive it as an empty buffer.
      this.emit({ path: null, content: "", dirty: false });
    }
    return true;
  }

  edit(content: string): void {
    if (this.st.path === null) return;
    this.emit({ content, dirty: true });
  }

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

  // waits for the in-flight write so it can't recreate the file after the delete; dirty is
  // cleared at the end, not up front, so flush's own bookkeeping stays intact while it runs.
  async remove(): Promise<DeleteVaultEntryResult | null> {
    const path = this.st.path;
    if (path === null) return null;
    if (this.writing) await this.writing.catch(() => {});
    this.readSeq++; // cancel any in-flight read of this path
    let outcome: DeleteVaultEntryResult | null = null;
    try {
      outcome = await this.io.remove(path);
    } catch {
      // the file's fate is unknown, so the note stays.
    }
    if (outcome !== null && outcome.outcome !== "held") {
      this.emit({ path: null, content: "", dirty: false });
    }
    return outcome;
  }

  private async reloadOpen(): Promise<void> {
    const path = this.st.path;
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
      if (this.st.path === path && !this.st.dirty) {
        this.emit({ path: null, content: "", dirty: false });
      }
    }
  }
}
