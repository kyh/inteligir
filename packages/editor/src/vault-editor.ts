// held outside React: every async edge (save-vs-reload, open-vs-reload, delete-vs-save) needs
// a guard that reads and writes in one tick, which render-timed refs cannot give.

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
  remove: (path: string) => Promise<void>;
}

export type SaveError =
  | { readonly kind: "vanished" }
  | { readonly kind: "refused"; readonly message: string };

export interface OpenEditorState {
  readonly kind: "open";
  readonly path: string;
  readonly content: string;
  readonly dirty: boolean;
  // the last write's failure, held until a write lands or the buffer is replaced; `dirty` stays set under it.
  readonly saveError: SaveError | null;
  // moves when bytes from the IO rather than an edit replace the buffer: a surface re-seeds from
  // them and its next keystroke saves them, so they are gated before it does, dirty or not.
  readonly diskSeq: number;
}

export type VaultEditorState = { readonly kind: "closed" } | OpenEditorState;

export const EMPTY_EDITOR_STATE: VaultEditorState = { kind: "closed" };

// a move in flight: `base` is the buffer as the move took it, null when it held edits no save
// had landed, and `reload` a change announced while held, run once resume has named the path.
interface Hold {
  readonly base: string | null;
  readonly released: PromiseWithResolvers<void>;
  reload: boolean;
}

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

// an echo of the buffer's own bytes (every save's) replaces nothing, so it leaves the seq alone.
const diskSeqFor = (st: OpenEditorState, content: string): number =>
  content === st.content ? st.diskSeq : st.diskSeq + 1;

export class VaultEditorController {
  private st: VaultEditorState = EMPTY_EDITOR_STATE;
  // only the latest read applies, so a slow read can't land over a newer one.
  private readSeq = 0;
  private writing: Promise<void> | null = null;
  // a reload a write pre-empted runs once the write settles: the bytes that write landed can
  // predate the change that asked for it, and no other echo is coming to show that change.
  private reloadDeferred = false;
  private held: Hold | null = null;
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

  private emit(next: VaultEditorState): void {
    this.st = next;
    for (const fn of this.subs) {
      fn();
    }
  }

  private loaded(path: string, content: string): OpenEditorState {
    return {
      content,
      diskSeq: this.st.kind === "open" ? this.st.diskSeq + 1 : 1,
      dirty: false,
      kind: "open",
      path,
      saveError: null,
    };
  }

  externalChange(): void {
    if (this.held !== null) {
      this.held.reload = true;
      return;
    }
    void this.reloadOpen();
  }

  async open(path: string, initial?: string): Promise<boolean> {
    await this.flush();
    // still dirty means the save failed — keep the current file open
    if (this.st.kind === "open" && this.st.dirty) {
      return false;
    }
    this.readSeq += 1;
    const seq = this.readSeq;
    if (initial !== undefined) {
      this.emit(this.loaded(path, initial));
      return true;
    }
    try {
      const text = await this.io.read(path);
      // a newer read (open or reload) won
      if (this.readSeq !== seq) {
        return true;
      }
      this.emit(this.loaded(path, text));
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
    if (this.st.kind === "closed") {
      return;
    }
    this.emit({ ...this.st, content, dirty: true });
  }

  private async writeSnapshot(path: string, snapshot: string): Promise<void> {
    let outcome: WriteOutcome;
    try {
      outcome = await this.io.write(path, snapshot);
    } catch (error) {
      // dirty stays set, so a later flush retries
      if (this.st.kind === "open" && this.st.path === path) {
        const message = error instanceof Error ? error.message : String(error);
        this.emit({ ...this.st, saveError: { kind: "refused", message } });
      }
      return;
    }
    // a file switch landed mid-write: stay dirty
    if (this.st.kind === "closed" || this.st.path !== path) {
      return;
    }
    if (outcome.kind === "vanished") {
      this.emit({ ...this.st, saveError: { kind: "vanished" } });
      return;
    }
    const landed = outcome.content;
    if (landed !== snapshot) {
      this.drain();
    }
    // read again: the drain may have handed over an edit.
    const st = this.getState();
    if (st.kind === "closed") {
      return;
    }
    // a newer edit made mid-write stays dirty, on top of what landed
    const rebased = rebase(snapshot, st.content, landed);
    this.emit({
      ...st,
      content: rebased.merged,
      diskSeq: diskSeqFor(st, rebased.merged),
      dirty: rebased.merged !== landed,
      saveError: null,
    });
    if (outcome.conflicted || rebased.conflicted) {
      this.onMergeConflict();
    }
  }

  async flush(): Promise<void> {
    if (this.held !== null) {
      await this.held.released.promise;
    }
    if (this.writing) {
      await this.writing.catch(ignoreRejection);
    }
    const { st } = this;
    if (st.kind === "closed" || !st.dirty) {
      return;
    }
    const writing = this.writeSnapshot(st.path, st.content);
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
  async remove(): Promise<boolean> {
    if (this.st.kind === "closed") {
      return false;
    }
    const { path } = this.st;
    if (this.writing) {
      await this.writing.catch(ignoreRejection);
    }
    // cancel any in-flight read of this path
    this.readSeq += 1;
    try {
      await this.io.remove(path);
    } catch {
      // the file's fate is unknown, so the note stays.
      return false;
    }
    this.emit(EMPTY_EDITOR_STATE);
    return true;
  }

  // the file was deleted under unsaved edits, so no write can land: create it again from the
  // buffer. false when the create is refused, as it is when anything landed at the path since.
  async recreate(): Promise<boolean> {
    if (this.st.kind === "closed") {
      return false;
    }
    const { path } = this.st;
    if (this.writing) {
      await this.writing.catch(ignoreRejection);
    }
    const before = this.getState();
    if (before.kind === "closed") {
      return false;
    }
    const snapshot = before.content;
    const outcome = await this.io.create(path, snapshot).catch(() => null);
    if (outcome?.kind !== "created") {
      return false;
    }
    const after = this.getState();
    if (after.kind === "open" && after.path === path) {
      this.emit({ ...after, dirty: after.content !== snapshot, saveError: null });
    }
    return true;
  }

  // a move takes the note from one path to another: edits keep landing in the buffer, but a save
  // or a reload, each of which names a path, waits until resume says which one.
  suspend(): void {
    if (this.held !== null) {
      return;
    }
    const { st } = this;
    const released: PromiseWithResolvers<void> = Promise.withResolvers();
    this.held = {
      base: st.kind === "open" && !st.dirty ? st.content : null,
      released,
      reload: false,
    };
  }

  // `path` is where the move left the note, or where it still is when the move failed. At a new
  // path the IO holds no base until it reads one there, and the move may have rewritten the
  // note's own links, so the edits typed while held are rebased onto what that read finds.
  async resume(path: string): Promise<void> {
    const { held, st } = this;
    if (held === null) {
      return;
    }
    if (st.kind === "open" && st.path !== path) {
      this.emit({ ...st, path });
      held.reload = false;
      await this.readOnto(path, held.base);
    }
    this.held = null;
    held.released.resolve();
    if (held.reload) {
      void this.reloadOpen();
    }
    await this.flush();
  }

  // a buffer dirty before the read is left to its save, whose CAS merges the external bytes in.
  private async reloadOpen(): Promise<void> {
    this.drain();
    const { st } = this;
    if (this.writing !== null) {
      this.reloadDeferred = true;
      return;
    }
    if (st.kind === "closed" || st.dirty) {
      return;
    }
    await this.readOnto(st.path, st.content);
  }

  // the read moves the IO's base to what it finds: the buffer's edits since `base` are rebased
  // onto it, because left alone the next save would pass the CAS and erase those bytes. A null
  // `base` keeps the buffer whole.
  private async readOnto(path: string, base: string | null): Promise<void> {
    this.readSeq += 1;
    const seq = this.readSeq;
    try {
      const text = await this.io.read(path);
      if (this.readSeq !== seq || this.st.kind === "closed" || this.st.path !== path) {
        return;
      }
      if (this.writing !== null) {
        this.reloadDeferred = true;
        return;
      }
      this.drain();
      // read again: the drain may have handed over an edit.
      const st = this.getState();
      if (st.kind === "closed") {
        return;
      }
      const rebased = rebase(base ?? text, st.content, text);
      this.emit({
        ...st,
        content: rebased.merged,
        diskSeq: diskSeqFor(st, rebased.merged),
        dirty: rebased.merged !== text,
      });
      if (rebased.conflicted) {
        this.onMergeConflict();
      }
    } catch {
      if (this.readSeq !== seq) {
        return;
      }
      if (this.st.kind === "open" && this.st.path === path && !this.st.dirty) {
        this.emit(EMPTY_EDITOR_STATE);
      }
    }
  }
}
