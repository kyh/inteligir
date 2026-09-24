// held outside React: every async edge (save-vs-reload, open-vs-reload, delete-vs-save) needs
// a guard that reads and writes in one tick, which render-timed refs cannot give.

import type { DeleteVaultEntryResult } from "@repo/editor/host-io";
import { diff3 } from "@repo/notes/text/diff3";
import type { Diff3Result } from "@repo/notes/text/diff3";

// `landed` carries the bytes that landed: a host that merges in a concurrent change lands more than
// it was sent, and `conflicted` says that merge kept the sent lines where both changed the same
// ones. `vanished` is a file deleted since its bytes were read, which no retry can land.
export type WriteOutcome =
  | { readonly kind: "landed"; readonly content: string; readonly conflicted: boolean }
  | { readonly kind: "vanished" };

// `exists` is an exclusive create finding the path taken, which a caller may step past under
// another name; every other failure rejects.
export type CreateOutcome = { readonly kind: "created" } | { readonly kind: "exists" };

export interface VaultIO {
  read: (path: string) => Promise<string>;
  // rejects on any failure a later attempt might get past.
  write: (path: string, content: string) => Promise<WriteOutcome>;
  create: (path: string, content: string) => Promise<CreateOutcome>;
  // rejects when the host cannot say the file is gone, so the note stays open over it.
  remove: (path: string) => Promise<DeleteVaultEntryResult>;
}

export type SaveError =
  | { readonly kind: "vanished" }
  | { readonly kind: "refused"; readonly message: string };

export interface VaultEditorState {
  readonly path: string | null;
  readonly content: string;
  readonly dirty: boolean;
  // the last write's failure, held until a write lands or the buffer is replaced; `dirty` stays set under it.
  readonly saveError: SaveError | null;
}

export const EMPTY_EDITOR_STATE: VaultEditorState = {
  content: "",
  dirty: false,
  path: null,
  saveError: null,
};

const ignoreRejection = (): void => {
  /* the write reports its own failure */
};

const drainNothing = (): void => {
  /* no surface holds edits back */
};

const tellNobody = (): void => {
  /* no host is told about a merge conflict */
};

// `landed` replaced `from` as the bytes the IO writes against, so the buffer's edits since `from`
// move onto it: kept over `from`, the next save would erase whatever else `landed` carries.
const rebase = (from: string, buffer: string, landed: string): Diff3Result => {
  if (buffer === from) {
    return { conflicted: false, merged: landed };
  }
  if (landed === from) {
    return { conflicted: false, merged: buffer };
  }
  return diff3(from, buffer, landed);
};

export class VaultEditorController {
  private st: VaultEditorState = EMPTY_EDITOR_STATE;
  // only the latest read applies, so a slow read can't land over a newer one.
  private readSeq = 0;
  private writing: Promise<void> | null = null;
  // a reload a write pre-empted runs once the write settles: the bytes that write landed can
  // predate the change that asked for it, and no other echo is coming to show that change.
  private reloadDeferred = false;
  private readonly subs = new Set<() => void>();
  private readonly io: VaultIO;
  // hands over edits a surface still holds back (the rich editor's serialize debounce) before
  // bytes from disk replace the buffer, so they are rebased rather than replayed over those bytes.
  private readonly drain: () => void;
  // told when a write's merge or a rebase kept the buffer's lines over a concurrent change to the
  // same ones: that change's lines there are gone from the file, or will be at the next save.
  private readonly onMergeConflict: () => void;

  constructor(
    io: VaultIO,
    drain: () => void = drainNothing,
    onMergeConflict: () => void = tellNobody,
  ) {
    this.io = io;
    this.drain = drain;
    this.onMergeConflict = onMergeConflict;
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

  externalChange(): void {
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
      this.emit({ content: initial, dirty: false, path, saveError: null });
      return true;
    }
    try {
      const text = await this.io.read(path);
      // a newer read (open or reload) won
      if (this.readSeq !== seq) {
        return true;
      }
      this.emit({ content: text, dirty: false, path, saveError: null });
    } catch {
      if (this.readSeq !== seq) {
        return true;
      }
      // unreadable (deleted between click and read): don't revive it as an empty buffer.
      this.emit(EMPTY_EDITOR_STATE);
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
    let outcome: WriteOutcome;
    try {
      outcome = await this.io.write(path, snapshot);
    } catch (error) {
      // dirty stays set, so a later flush retries
      if (this.st.path === path) {
        const message = error instanceof Error ? error.message : String(error);
        this.emit({ saveError: { kind: "refused", message } });
      }
      return;
    }
    // a file switch landed mid-write: stay dirty
    if (this.st.path !== path) {
      return;
    }
    if (outcome.kind === "vanished") {
      this.emit({ saveError: { kind: "vanished" } });
      return;
    }
    const landed = outcome.content;
    if (landed !== snapshot) {
      this.drain();
    }
    // a newer edit made mid-write stays dirty, on top of what landed
    const rebased = rebase(snapshot, this.st.content, landed);
    this.emit({ content: rebased.merged, dirty: rebased.merged !== landed, saveError: null });
    if (outcome.conflicted || rebased.conflicted) {
      this.onMergeConflict();
    }
  }

  async flush(): Promise<void> {
    if (this.writing) {
      await this.writing.catch(ignoreRejection);
    }
    const { path } = this.st;
    if (path === null || !this.st.dirty) {
      return;
    }
    const snapshot = this.st.content;
    const writing = this.writeSnapshot(path, snapshot);
    this.writing = writing;
    await writing;
    if (this.writing === writing) {
      this.writing = null;
      if (this.reloadDeferred) {
        this.reloadDeferred = false;
        void this.reloadOpen();
      }
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
      await this.writing.catch(ignoreRejection);
    }
    // cancel any in-flight read of this path
    this.readSeq += 1;
    let outcome: DeleteVaultEntryResult | null = null;
    try {
      outcome = await this.io.remove(path);
    } catch {
      // the file's fate is unknown, so the note stays.
    }
    if (outcome !== null) {
      this.emit(EMPTY_EDITOR_STATE);
    }
    return outcome;
  }

  // the file was deleted under unsaved edits, so no write can land: create it again from the
  // buffer. false when the create is refused, as it is when anything landed at the path since.
  async recreate(): Promise<boolean> {
    const { path } = this.st;
    if (path === null) {
      return false;
    }
    if (this.writing) {
      await this.writing.catch(ignoreRejection);
    }
    const snapshot = this.st.content;
    const outcome = await this.io.create(path, snapshot).catch(() => null);
    if (outcome?.kind !== "created") {
      return false;
    }
    if (this.st.path === path) {
      this.emit({ dirty: this.st.content !== snapshot, saveError: null });
    }
    return true;
  }

  // a buffer dirty before the read is left to its save, whose CAS merges the external bytes in.
  private async reloadOpen(): Promise<void> {
    this.drain();
    const { path, content: before } = this.st;
    if (this.writing !== null) {
      this.reloadDeferred = true;
      return;
    }
    if (path === null || this.st.dirty) {
      return;
    }
    this.readSeq += 1;
    const seq = this.readSeq;
    try {
      const text = await this.io.read(path);
      if (this.readSeq !== seq || this.st.path !== path) {
        return;
      }
      if (this.writing !== null) {
        this.reloadDeferred = true;
        return;
      }
      // the read moved the IO's base to `text`: an edit made while it was in flight is rebased,
      // because left alone the next save would pass the CAS and erase the external bytes.
      this.drain();
      const rebased = rebase(before, this.st.content, text);
      this.emit({ content: rebased.merged, dirty: rebased.merged !== text });
      if (rebased.conflicted) {
        this.onMergeConflict();
      }
    } catch {
      if (this.readSeq !== seq) {
        return;
      }
      if (this.st.path === path && !this.st.dirty) {
        this.emit(EMPTY_EDITOR_STATE);
      }
    }
  }
}
