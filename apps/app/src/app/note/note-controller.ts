// The open note's save pipeline, framework-free so it unit-tests under fake
// timers: a debounced compare-and-swap PUT (quiet period after the last
// keystroke), an explicit flush for blur/close/navigation that REJECTS when
// the content did not become durable, and the external-change path — disk
// content is adopted when the buffer is clean, three-way merged when it is
// not, preferring the buffer on a genuine overlap.
//
// The merge base is VERSIONED: every adoption bumps a monotonic counter, and
// a save's resolution only installs its content as the new base if the
// counter still holds the value captured at send time — a base that advanced
// mid-flight (external adopt/merge) must never be clobbered by a stale
// resolution.

import { diff3 } from "./diff3";

/** The slice of the editor handle the controller drives. */
export interface NoteBuffer {
  getDoc(): string;
  /** Whole-buffer replace that preserves the selection (replaceDoc). */
  replaceDoc(next: string): void;
}

/** What one guarded save attempt resolved to. Anything that is neither an
 * applied write nor a CAS refusal must THROW instead. */
export type SaveResult =
  | { ok: true }
  | { ok: false; kind: "cas"; current: { content: string } | null };

export interface NoteControllerArgs {
  buffer: NoteBuffer;
  /** The note's content as loaded — the initial merge base. */
  initialContent: string;
  /** Attempt ONE guarded save of `content`, derived from `base` (the seam
   * hashes the base for the wire). Resolves ok:false only for a CAS refusal. */
  save: (content: string, base: string) => Promise<SaveResult>;
  /** An external change overlapped an unsaved edit; the buffer won. */
  onConflict: () => void;
  onSaveError: (error: unknown) => void;
  debounceMs?: number;
}

const NOTE_SAVE_DEBOUNCE_MS = 800;

export class NoteController {
  private readonly args: NoteControllerArgs;
  private readonly debounceMs: number;
  /** What this client last knew to be on disk — the diff3 base. */
  private lastSaved: string;
  /** Bumped on every base adoption; guards stale save resolutions. */
  private baseVersion = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private disposed = false;

  constructor(args: NoteControllerArgs) {
    this.args = args;
    this.debounceMs = args.debounceMs ?? NOTE_SAVE_DEBOUNCE_MS;
    this.lastSaved = args.initialContent;
  }

  /** Call on every editor doc change: (re)arms the quiet-period save. */
  docChanged(): void {
    if (this.disposed) {
      return;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      // Failures already reached onSaveError; the timer path has no caller
      // to reject to.
      void this.flush().catch(() => {});
    }, this.debounceMs);
  }

  /**
   * Saves now if the buffer differs from what was last saved; resolves once
   * the final state is durable and REJECTS when it is not (the caller gates
   * on it — a rename must not proceed over a failed save). Serialized: a
   * flush during an in-flight save waits for it, then re-checks. Runs to
   * completion even if dispose() lands mid-await — dispose stops future
   * timers, never an in-progress save.
   */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inflight !== null) {
      // A previous attempt's failure belongs to ITS caller; this flush
      // re-evaluates and makes its own attempt.
      await this.inflight.catch(() => {});
    }
    if (this.args.buffer.getDoc() === this.lastSaved) {
      return;
    }
    const attempt = this.performSave();
    this.inflight = attempt;
    try {
      await attempt;
    } finally {
      if (this.inflight === attempt) {
        this.inflight = null;
      }
    }
  }

  /** One guarded attempt plus at most one merge-and-retry after a CAS refusal. */
  private async performSave(): Promise<void> {
    const content = this.args.buffer.getDoc();
    const base = this.lastSaved;
    const sentVersion = this.baseVersion;
    const result = await this.runSave(content, base);
    if (result.ok) {
      this.resolveApplied(content, sentVersion);
      return;
    }
    if (this.baseVersion !== sentVersion) {
      // Newer external truth arrived and was reconciled while this attempt
      // was in flight; its refusal is stale. Re-arm if still dirty.
      this.rearmIfDirty();
      return;
    }
    if (result.current === null) {
      const error = new Error("The note no longer exists on disk.");
      this.args.onSaveError(error);
      throw error;
    }
    // Merge against the server's truth, then retry once with the new base.
    this.applyExternal(result.current.content);
    const retryContent = this.args.buffer.getDoc();
    if (retryContent === this.lastSaved) {
      return;
    }
    const retryVersion = this.baseVersion;
    const retryResult = await this.runSave(retryContent, this.lastSaved);
    if (retryResult.ok) {
      this.resolveApplied(retryContent, retryVersion);
      return;
    }
    if (this.baseVersion !== retryVersion) {
      this.rearmIfDirty();
      return;
    }
    const error = new Error("The note keeps changing on disk; your edits stay in the editor.");
    this.args.onSaveError(error);
    throw error;
  }

  private async runSave(content: string, base: string): Promise<SaveResult> {
    try {
      return await this.args.save(content, base);
    } catch (error) {
      this.args.onSaveError(error);
      throw error;
    }
  }

  /** Install an applied write as the new base — only if the base did not
   *  advance while the write was in flight (finding: a stale resolution must
   *  never clobber newer external truth). */
  private resolveApplied(content: string, sentVersion: number): void {
    if (this.baseVersion === sentVersion) {
      this.adoptBase(content);
      return;
    }
    this.rearmIfDirty();
  }

  private rearmIfDirty(): void {
    if (this.args.buffer.getDoc() !== this.lastSaved) {
      this.docChanged();
    }
  }

  private adoptBase(content: string): void {
    this.lastSaved = content;
    this.baseVersion += 1;
  }

  /**
   * Disk changed under us. Clean buffer → adopt disk in place (cursor kept).
   * Dirty buffer → diff3(lastSaved, buffer, disk); the merge result becomes
   * the buffer and disk becomes the new base, so the merge (or, on conflict,
   * the preferred buffer) is saved back by the next quiet period.
   */
  externalContent(disk: string): void {
    if (this.disposed) {
      return;
    }
    this.applyExternal(disk);
  }

  private applyExternal(disk: string): void {
    if (disk === this.lastSaved) {
      return;
    }
    const mine = this.args.buffer.getDoc();
    if (mine === this.lastSaved) {
      this.adoptBase(disk);
      this.args.buffer.replaceDoc(disk);
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      return;
    }
    if (mine === disk) {
      this.adoptBase(disk);
      return;
    }
    const { merged, conflicted } = diff3(this.lastSaved, mine, disk);
    this.adoptBase(disk);
    this.args.buffer.replaceDoc(merged);
    if (conflicted) {
      this.args.onConflict();
    }
    if (merged !== disk) {
      this.docChanged();
    }
  }

  /** True when the buffer holds changes the disk has not seen. */
  isDirty(): boolean {
    return this.args.buffer.getDoc() !== this.lastSaved;
  }

  /** Stops future timers. Never interrupts an in-flight save — callers that
   *  need durability await flush() FIRST. */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
