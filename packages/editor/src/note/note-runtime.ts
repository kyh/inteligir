import type { DeleteVaultEntryResult } from "@repo/editor/host-io";

import { VaultEditorController } from "@repo/editor/vault-editor";
import type { VaultIO } from "@repo/editor/vault-editor";
import { createDebouncer } from "@repo/editor/lib/debounce";

const AUTOSAVE_DEBOUNCE_MS = 600;

export interface NoteRuntimeCallbacks {
  onVanished: (path: string) => void;
}

export type NoteRuntime = ReturnType<typeof createNoteRuntime>;

// the caller disposes the previous runtime first; this one never checks.
export const createNoteRuntime = (
  path: string,
  root: string,
  io: VaultIO,
  cb: NoteRuntimeCallbacks,
  initial?: string,
) => {
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
    if (st.path === path) {
      opened = true;
    } else if (opened && st.path === null) {
      cb.onVanished(path);
    }
  });

  const openNote = async (): Promise<void> => {
    await controller.open(path, initial);
    // unreadable on first load: it never held content, so it closes silently.
    if (!disposed && controller.getState().path !== path) {
      cb.onVanished(path);
    }
  };
  void openNote();

  return {
    controller,
    dispose(): void {
      disposed = true;
      autosave.cancel();
      unsubscribe();
    },
    edit(next: string): void {
      // teardown settles and re-seed echoes emit unchanged content; don't dirty the buffer for them.
      if (controller.getState().content === next) {
        return;
      }
      controller.edit(next);
      autosave.schedule();
    },
    async flush(): Promise<boolean> {
      preFlush?.();
      autosave.cancel();
      await controller.flush();
      return !controller.getState().dirty;
    },
    // not the controller's path, which is null until the first load.
    path,
    // runs at the top of flush() and remove(); the rich editor drains its serialize debounce
    // here so a pending keystroke persists. last registration wins.
    registerPreFlush(fn: (() => void) | null): void {
      preFlush = fn;
    },
    // a held delete leaves the note open because the file is still there; null is a delete that threw.
    async remove(): Promise<DeleteVaultEntryResult | null> {
      preFlush?.();
      autosave.cancel();
      return await controller.remove();
    },
  };
};
