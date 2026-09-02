import type { DeleteVaultEntryResult } from "@repo/editor/host-io";

import { VaultEditorController, type VaultIO } from "@repo/editor/vault-editor";
import { createDebouncer } from "@repo/editor/lib/debounce";

const AUTOSAVE_DEBOUNCE_MS = 600;

export type NoteRuntimeCallbacks = {
  onVanished(path: string): void;
};

export type NoteRuntime = {
  /** not the controller's path, which is null until the first load. */
  readonly path: string;
  readonly controller: VaultEditorController;
  edit(next: string): void;
  /** runs at the top of flush() and remove(); the rich editor drains its serialize
   * debounce here so a pending keystroke persists. last registration wins. */
  registerPreFlush(fn: (() => void) | null): void;
  flush(): Promise<boolean>;
  dispose(): void;
  /** a held delete leaves the note open because the file is still there; null is a delete that threw. */
  remove(): Promise<DeleteVaultEntryResult | null>;
};

// the caller disposes the previous runtime first; this one never checks.
export function createNoteRuntime(
  path: string,
  root: string,
  io: VaultIO,
  cb: NoteRuntimeCallbacks,
  initial?: string,
): NoteRuntime {
  const controller = new VaultEditorController(io);
  controller.setRoot(root);

  const autosave = createDebouncer(() => {
    void controller.flush();
  }, AUTOSAVE_DEBOUNCE_MS);
  let preFlush: (() => void) | null = null;
  // gates the vanish watcher so the initial path:null state doesn't close the note.
  let opened = false;
  // a still-pending open() resolving after dispose must not drop a runtime the
  // provider has already replaced.
  let disposed = false;

  const unsubscribe = controller.subscribe(() => {
    const st = controller.getState();
    if (st.path === path) opened = true;
    else if (opened && st.path === null) cb.onVanished(path);
  });

  void controller.open(path, initial).then(() => {
    // unreadable on first load: it never held content, so it closes silently.
    if (!disposed && controller.getState().path !== path) cb.onVanished(path);
    return undefined;
  });

  return {
    path,
    controller,
    edit(next: string): void {
      // teardown settles and re-seed echoes emit unchanged content; don't dirty the buffer for them.
      if (controller.getState().content === next) return;
      controller.edit(next);
      autosave.schedule();
    },
    registerPreFlush(fn: (() => void) | null): void {
      preFlush = fn;
    },
    async flush(): Promise<boolean> {
      preFlush?.();
      autosave.cancel();
      await controller.flush();
      return !controller.getState().dirty;
    },
    dispose(): void {
      disposed = true;
      autosave.cancel();
      unsubscribe();
    },
    remove(): Promise<DeleteVaultEntryResult | null> {
      preFlush?.();
      autosave.cancel();
      return controller.remove();
    },
  };
}
