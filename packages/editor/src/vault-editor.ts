// held outside React: every async edge (save-vs-reload, open-vs-reload, root switch,
// delete-vs-save) needs a guard that reads and writes in one tick, which render-timed refs
// cannot give.

import type { DeleteVaultEntryResult } from "@repo/editor/host-io";

export interface VaultIO {
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  // refuses an existing path.
  create: (path: string, content: string) => Promise<void>;
  // answers the outcome: the host can hold a delete, and closing the note anyway would report
  // a deletion that did not happen.
  remove: (path: string) => Promise<DeleteVaultEntryResult>;
}

export interface VaultEditorState {
  readonly root: string;
  readonly path: string | null;
  readonly content: string;
  readonly dirty: boolean;
  readonly saving: boolean;
}

const EMPTY: VaultEditorState = { content: "", dirty: false, path: null, root: "", saving: false };

export class VaultEditorController {
  private st: VaultEditorState = EMPTY;
  // only the latest read applies, so a slow read can't land over a newer one.
  private readSeq = 0;
  private writing: Promise<void> | null = null;
  private readonly subs = new Set<() => void>();
  private readonly io: VaultIO;

  constructor(io: VaultIO) {
    this.io = io;
  }

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
    for (const fn of this.subs) {
      fn();
    }
  }

  setRoot(root: string): void {
    if (root !== this.st.root) {
      this.emit({ root });
    }
  }

  // the empty sentinel before the root is first known is not a switch, or the user's own first
  // autosave broadcast would wipe their edits.
  externalChange(nextRoot: string): void {
    const rootChanged = this.st.root !== "" && nextRoot !== this.st.root;
    if (rootChanged) {
      // cancel in-flight reads against the old root
      this.readSeq += 1;
      this.st = { ...EMPTY, root: nextRoot };
      for (const fn of this.subs) {
        fn();
      }
      return;
    }
    if (nextRoot !== this.st.root) {
      this.emit({ root: nextRoot });
    }
    void this.reloadOpen();
  }

  async open(path: string, initial?: string): Promise<boolean> {
    await this.flush();
    // still dirty means the save failed — keep the current file open
    if (this.st.dirty) {
      return false;
    }
    this.readSeq += 1;
    const seq = this.readSeq;
    if (initial !== undefined) {
      this.emit({ content: initial, dirty: false, path });
      return true;
    }
    try {
      const text = await this.io.read(path);
      // a newer read (open or reload) won
      if (this.readSeq !== seq) {
        return true;
      }
      this.emit({ content: text, dirty: false, path });
    } catch {
      if (this.readSeq !== seq) {
        return true;
      }
      // unreadable (deleted between click and read): don't revive it as an empty buffer.
      this.emit({ content: "", dirty: false, path: null });
    }
    return true;
  }

  edit(content: string): void {
    if (this.st.path === null) {
      return;
    }
    this.emit({ content, dirty: true });
  }

  private async writeSnapshot(path: string, snapshot: string): Promise<void> {
    try {
      await this.io.write(path, snapshot);
    } catch {
      // leave dirty set so a later flush retries
      this.emit({ saving: false });
      return;
    }
    if (this.st.path === path && this.st.content === snapshot) {
      this.emit({ dirty: false, saving: false });
      return;
    }
    // a newer edit or a file switch landed mid-write — stay dirty
    this.emit({ saving: false });
  }

  async flush(): Promise<void> {
    if (this.writing) {
      await this.writing.catch(() => {
        /* empty */
      });
    }
    const { path } = this.st;
    if (path === null || !this.st.dirty) {
      return;
    }
    const snapshot = this.st.content;
    this.emit({ saving: true });
    const writing = this.writeSnapshot(path, snapshot);
    this.writing = writing;
    await writing;
    if (this.writing === writing) {
      this.writing = null;
    }
  }

  // waits for the in-flight write so it can't recreate the file after the delete; dirty is
  // cleared at the end, not up front, so flush's own bookkeeping stays intact while it runs.
  async remove(): Promise<DeleteVaultEntryResult | null> {
    const { path } = this.st;
    if (path === null) {
      return null;
    }
    if (this.writing) {
      await this.writing.catch(() => {
        /* empty */
      });
    }
    // cancel any in-flight read of this path
    this.readSeq += 1;
    let outcome: DeleteVaultEntryResult | null = null;
    try {
      outcome = await this.io.remove(path);
    } catch {
      // the file's fate is unknown, so the note stays.
    }
    if (outcome !== null && outcome.outcome !== "held") {
      this.emit({ content: "", dirty: false, path: null });
    }
    return outcome;
  }

  private async reloadOpen(): Promise<void> {
    const { path } = this.st;
    if (path === null || this.st.dirty || this.writing) {
      return;
    }
    this.readSeq += 1;
    const seq = this.readSeq;
    try {
      const text = await this.io.read(path);
      if (this.readSeq !== seq) {
        return;
      }
      if (this.st.path === path && !this.st.dirty && this.writing === null) {
        this.emit({ content: text });
      }
    } catch {
      if (this.readSeq !== seq) {
        return;
      }
      if (this.st.path === path && !this.st.dirty) {
        this.emit({ content: "", dirty: false, path: null });
      }
    }
  }
}
