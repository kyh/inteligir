// The open note's save pipeline, framework-free so it unit-tests under fake
// timers: a debounced PUT (quiet period after the last keystroke), an
// explicit flush for blur/close/navigation, and the external-change path —
// disk content is adopted when the buffer is clean, three-way merged when it
// is not, preferring the buffer on a genuine overlap.

import { diff3 } from "./diff3";

/** The slice of the editor handle the controller drives. */
export interface NoteBuffer {
  getDoc(): string;
  /** Whole-buffer replace that preserves the selection (replaceDoc). */
  replaceDoc(next: string): void;
}

export interface NoteControllerArgs {
  buffer: NoteBuffer;
  /** The note's content as loaded — the initial merge base. */
  initialContent: string;
  save: (content: string) => Promise<void>;
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
      void this.flush();
    }, this.debounceMs);
  }

  /** Saves now if the buffer differs from what was last saved. Serialized:
   *  a flush during an in-flight save waits for it, then re-checks. */
  async flush(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inflight !== null) {
      await this.inflight;
    }
    if (this.disposed) {
      return;
    }
    const content = this.args.buffer.getDoc();
    if (content === this.lastSaved) {
      return;
    }
    const attempt = (async () => {
      try {
        await this.args.save(content);
        this.lastSaved = content;
      } catch (error) {
        this.args.onSaveError(error);
      }
    })();
    this.inflight = attempt;
    try {
      await attempt;
    } finally {
      if (this.inflight === attempt) {
        this.inflight = null;
      }
    }
  }

  /**
   * Disk changed under us. Clean buffer → adopt disk in place (cursor kept).
   * Dirty buffer → diff3(lastSaved, buffer, disk); the merge result becomes
   * the buffer and disk becomes the new base, so the merge (or, on conflict,
   * the preferred buffer) is saved back by the next quiet period.
   */
  externalContent(disk: string): void {
    if (this.disposed || disk === this.lastSaved) {
      return;
    }
    const mine = this.args.buffer.getDoc();
    if (mine === this.lastSaved) {
      this.lastSaved = disk;
      this.args.buffer.replaceDoc(disk);
      if (this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      return;
    }
    if (mine === disk) {
      this.lastSaved = disk;
      return;
    }
    const { merged, conflicted } = diff3(this.lastSaved, mine, disk);
    this.lastSaved = disk;
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

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
