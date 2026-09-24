import { VaultEditorController } from "@repo/editor/vault-editor";
import type { SaveError, VaultIO } from "@repo/editor/vault-editor";
import { createDebouncer } from "@repo/editor/lib/debounce";

const AUTOSAVE_DEBOUNCE_MS = 600;
// a refused save is retried on its own, since nothing else re-arms the autosave until the next
// keystroke; the backoff keeps a host that stays down from being asked every few hundred ms.
const RETRY_BASE_MS = 2000;
const RETRY_CAP_MS = 30_000;
// a keystroke typed while a flush's write is in flight earns it another pass; bounded, since a
// typist can outrun it.
const FLUSH_PASSES = 3;

export interface NoteRuntimeCallbacks {
  onVanished: (path: string) => void;
  onMergeConflict?: (path: string) => void;
}

export type NoteRuntime = ReturnType<typeof createNoteRuntime>;

// the caller disposes the previous runtime first; this one never checks.
export const createNoteRuntime = (
  openedAt: string,
  io: VaultIO,
  cb: NoteRuntimeCallbacks,
  initial?: string,
) => {
  // moves only when a rename carries the note.
  let path = openedAt;
  let preFlush: (() => void) | null = null;
  const controller = new VaultEditorController(
    io,
    () => {
      preFlush?.();
    },
    () => {
      cb.onMergeConflict?.(path);
    },
  );

  const autosave = createDebouncer(() => {
    void controller.flush();
  }, AUTOSAVE_DEBOUNCE_MS);
  // gates the vanish watcher so the initial closed state doesn't close the note.
  let opened = false;
  // a still-pending open() resolving after dispose must not drop a runtime the
  // provider has already replaced.
  let disposed = false;

  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const cancelRetry = (): void => {
    if (retry !== null) {
      clearTimeout(retry);
      retry = null;
    }
  };
  // every failed attempt emits a fresh error, and an edit carries the standing one over, so a
  // new identity is a new failure; a vanished file refuses every retry, so only a refused
  // write is tried again.
  let lastError: SaveError | null = null;
  const onSaveError = (error: SaveError | null): void => {
    if (error === lastError) {
      return;
    }
    lastError = error;
    cancelRetry();
    if (error === null) {
      failures = 0;
      return;
    }
    if (error.kind === "vanished") {
      return;
    }
    failures += 1;
    retry = setTimeout(
      () => {
        retry = null;
        void controller.flush();
      },
      Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (failures - 1)),
    );
  };

  const unsubscribe = controller.subscribe(() => {
    const st = controller.getState();
    if (st.kind === "open" && st.path === path) {
      opened = true;
    } else if (opened && st.kind === "closed") {
      cb.onVanished(path);
    }
    onSaveError(st.kind === "open" ? st.saveError : null);
  });

  const openNote = async (): Promise<void> => {
    await controller.open(path, initial);
    const st = controller.getState();
    // unreadable on first load: it never held content, so it closes silently.
    if (!disposed && (st.kind === "closed" || st.path !== path)) {
      cb.onVanished(path);
    }
  };
  void openNote();

  const dirty = (): boolean => {
    const st = controller.getState();
    return st.kind === "open" && st.dirty;
  };

  return {
    controller,
    dispose(): void {
      disposed = true;
      // a write still in flight must not drain a surface this runtime no longer owns.
      preFlush = null;
      autosave.cancel();
      cancelRetry();
      unsubscribe();
    },
    edit(next: string): void {
      const st = controller.getState();
      // teardown settles and re-seed echoes emit unchanged content; don't dirty the buffer for them.
      if (st.kind === "closed" || st.content === next) {
        return;
      }
      controller.edit(next);
      autosave.schedule();
    },
    // true once every edit made so far is on disk, including one typed while the write was in
    // flight, so a caller that disposes straight after drops nothing.
    async flush(): Promise<boolean> {
      for (let pass = 0; pass < FLUSH_PASSES; pass += 1) {
        preFlush?.();
        autosave.cancel();
        await controller.flush();
        const st = controller.getState();
        if (st.kind === "open" && st.saveError !== null) {
          break;
        }
        // the write's await let the surface hold a keystroke back; hand it over before calling
        // the buffer clean.
        preFlush?.();
        if (!dirty()) {
          break;
        }
      }
      return !dirty();
    },
    // not the controller's path, which a closed controller does not have.
    get path(): string {
      return path;
    },
    // a rename carries the note: its edits keep landing in the buffer while the move runs, and
    // resume names where the move left it, or where it still is when the move failed.
    suspend(): void {
      controller.suspend();
    },
    async resume(to: string): Promise<void> {
      // the surface sends its edits under the path it opened at, so what it still holds back is
      // handed over before the note answers to another
      preFlush?.();
      path = to;
      await controller.resume(to);
    },
    // the file was deleted under unsaved edits: create it again from the buffer.
    async recreate(): Promise<boolean> {
      autosave.cancel();
      return await controller.recreate();
    },
    // runs at the top of flush() and remove(), and before the controller takes bytes from disk;
    // the rich editor drains its serialize debounce here so a pending keystroke persists. last
    // registration wins.
    registerPreFlush(fn: (() => void) | null): void {
      preFlush = fn;
    },
    // false is a delete that threw, and the note stays open.
    async remove(): Promise<boolean> {
      preFlush?.();
      autosave.cancel();
      cancelRetry();
      return await controller.remove();
    },
  };
};
