// NoteRuntime — the open note's live machinery, extracted from vault-context so
// the debounce/vanish lifecycle can be characterized in isolation. The provider
// owns WHEN to create/dispose one (open/rename/delete/root-switch ordering —
// those races live in vault-context); this owns HOW one behaves: the editor
// controller, the autosave debounce timer, and the vanish watcher that fires
// when the file disappears out from under the open note.

import { VaultEditorController, type VaultIO } from "@renderer/editor/vault-editor";

/** How long after the last edit the autosave debounce waits before flushing. */
const AUTOSAVE_DEBOUNCE_MS = 600;

export type NoteRuntimeCallbacks = {
  /** The open note's file vanished — either after a successful load (deleted
   * externally / removed under it) or unreadable on the very first load. The
   * provider drops the note. */
  onVanished(path: string): void;
};

/** The open note's live machinery: its editor controller (per-doc state), its
 * autosave debounce, and the vanish watcher that closes the note when the file
 * disappears out from under it. */
export type NoteRuntime = {
  /** The vault-relative path this runtime serves — flush/settle key off it, so
   * it must not depend on the controller's (possibly not-yet-loaded) state. */
  readonly path: string;
  /** The underlying editing session. Exposed so the provider can subscribe for
   * renders, adopt a root, and feed external/vault-changed reloads through it. */
  readonly controller: VaultEditorController;
  /** Record an edit to this note's buffer (debounced autosave). */
  edit(next: string): void;
  /** Register a pre-flush hook the runtime runs at the top of flush() and
   * before remove(). The Rich editor registers its serialize flush here so a
   * keystroke still in the serialize debounce is drained into the buffer
   * before the runtime persists. Last registration wins; null clears it. */
  registerPreFlush(fn: (() => void) | null): void;
  /** Persist pending edits now, clearing the debounce. Resolves true when the
   * buffer is clean. */
  flush(): Promise<boolean>;
  /** Tear down: clear the debounce timer and unsubscribe the vanish watcher. */
  dispose(): void;
  /** Delete the underlying file (clears the debounce timer first). */
  remove(): Promise<void>;
};

/** Create the runtime for a note and start loading its file. The caller (the
 * provider) must have disposed any previous runtime first — it owns that
 * ordering. `root` is adopted before the load so controller state is correct
 * from the first emission. */
export function createNoteRuntime(
  path: string,
  root: string,
  io: VaultIO,
  cb: NoteRuntimeCallbacks,
): NoteRuntime {
  const controller = new VaultEditorController(io);
  controller.setRoot(root);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // Runs at the top of flush()/remove() — the Rich editor's serialize flush,
  // draining any keystroke still sitting in the serialize debounce into the
  // buffer before the runtime persists (or discards) the file.
  let preFlush: (() => void) | null = null;
  // The controller has successfully loaded its path at least once — gates the
  // vanish watcher so the initial `path: null` state doesn't close the note.
  let opened = false;
  // Set once dispose() runs so a still-pending open() resolving afterward can't
  // fire a drop for a runtime the provider has already replaced (the original
  // `runtimeRef.current === runtime` guard — replacement always disposes first).
  let disposed = false;

  const clearTimer = (): void => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };

  const unsubscribe = controller.subscribe(() => {
    const st = controller.getState();
    if (st.path === path) opened = true;
    // The file vanished under the open note (deleted externally / removed) —
    // the note closes rather than lingering over nothing.
    else if (opened && st.path === null) cb.onVanished(path);
  });

  void controller.open(path).then(() => {
    // Unreadable on first load (e.g. a restored note whose file is gone) — it
    // never held content, so it silently closes.
    if (!disposed && controller.getState().path !== path) cb.onVanished(path);
    return undefined;
  });

  return {
    path,
    controller,
    edit(next: string): void {
      // Identical bytes are a no-op (teardown settles and re-seed echoes can
      // emit unchanged content) — don't dirty the buffer or schedule a write.
      if (controller.getState().content === next) return;
      controller.edit(next);
      clearTimer();
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void controller.flush();
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    registerPreFlush(fn: (() => void) | null): void {
      preFlush = fn;
    },
    async flush(): Promise<boolean> {
      preFlush?.();
      clearTimer();
      await controller.flush();
      return !controller.getState().dirty;
    },
    dispose(): void {
      disposed = true;
      clearTimer();
      unsubscribe();
    },
    async remove(): Promise<void> {
      preFlush?.();
      clearTimer();
      await controller.remove();
    },
  };
}
