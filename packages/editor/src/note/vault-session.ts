// Construction is inert: nothing subscribes, schedules or fetches until `start()`,
// so React 19's double-invoked initializer can build one and discard it.

import { vaultChangeTouches } from "@repo/editor/host-io";
import type { VaultActions, VaultChangedEvent, VaultEntry } from "@repo/editor/host-io";
import type { OpenPathChange } from "@repo/editor/note/open-note-store";
import { createNoteRuntime } from "@repo/editor/note/note-runtime";
import type { NoteRuntime } from "@repo/editor/note/note-runtime";
import type { VaultEditorState, VaultIO } from "@repo/editor/vault-editor";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { basenamePath, dirnamePath } from "@repo/notes/knowledge/vault-path";

export interface WorkspaceBoot {
  readonly entries: VaultEntry[];
  readonly openNote: { readonly path: string; readonly content: string } | null;
}

export type RenameResult = { ok: true } | { ok: false; error: string };

export interface VaultSessionPorts {
  boot: () => Promise<WorkspaceBoot>;
  list: () => Promise<VaultEntry[]>;
  exists: (path: string) => Promise<boolean>;
  rename: (from: string, to: string) => Promise<RenameResult>;
  note: VaultIO;
  publishListing: (entries: VaultEntry[]) => void;
  publishOpenPath: (path: string | null, change: OpenPathChange) => void;
  publishEditor: (state: VaultEditorState) => void;
  notify: (message: string) => void;
}

export interface VaultSession {
  // identity is fixed for the session's life: a consumer that only acts never re-renders.
  readonly actions: VaultActions;
  // safe to call again after `stop()`.
  start: () => Promise<void>;
  stop: () => void;
  handleVaultChanged: (event: VaultChangedEvent) => void;
}

const withDefaultExtension = (name: string): string =>
  /\.[a-z0-9]+$/iu.test(name) ? name : `${name}.md`;

// only the basename is checked: `notes/foo` is foldering here, unlike a `/` typed into the title.
const validNotePath = (
  path: string,
): { ok: true; path: string } | { ok: false; message: string } => {
  const verdict = checkNoteName(basenamePath(path));
  if (!verdict.ok) {
    return { message: noteNameErrorMessage(verdict.reason), ok: false };
  }
  const dir = dirnamePath(path);
  return { ok: true, path: dir === "" ? verdict.name : `${dir}/${verdict.name}` };
};

export const createVaultSession = (ports: VaultSessionPorts): VaultSession => {
  let running = false;
  let entries: VaultEntry[] = [];
  let openPath: string | null = null;
  let runtime: NoteRuntime | null = null;
  // separate from the runtime's own vanish watcher; disposing must clear both.
  let unpublish: (() => void) | null = null;
  // overlapping listings apply in issue order, never arrival order.
  let listSeq = 0;

  const applyOpenPath = (next: string | null, change: OpenPathChange = "navigate"): void => {
    if (next === openPath) {
      return;
    }
    openPath = next;
    ports.publishOpenPath(next, change);
  };

  const disposeRuntime = (): void => {
    unpublish?.();
    unpublish = null;
    runtime?.dispose();
    runtime = null;
  };

  const dropNote = (path: string): void => {
    if (runtime?.path !== path) {
      return;
    }
    disposeRuntime();
    applyOpenPath(null);
  };

  // callers dispose any previous runtime first.
  const ensureRuntime = (path: string, initial?: string): NoteRuntime => {
    if (runtime?.path === path) {
      return runtime;
    }
    const created = createNoteRuntime(path, ports.note, { onVanished: dropNote }, initial);
    runtime = created;
    // subscribe before the first publish so no emission slips between snapshot and subscription.
    const publish = (): void => {
      ports.publishEditor(created.controller.getState());
    };
    unpublish = created.controller.subscribe(publish);
    publish();
    return created;
  };

  const flush = async (): Promise<boolean> => {
    const current = runtime;
    if (current === null) {
      return true;
    }
    return await current.flush();
  };

  const openFile = (path: string): void => {
    void (async () => {
      if (openPath === path) {
        return;
      }
      if (!(await flush())) {
        ports.notify("Couldn't save the current file — resolve that before switching.");
        return;
      }
      disposeRuntime();
      ensureRuntime(path);
      applyOpenPath(path);
    })();
  };

  const refreshList = (): void => {
    listSeq += 1;
    const seq = listSeq;
    void (async () => {
      try {
        const next = await ports.list();
        if (seq !== listSeq) {
          return;
        }
        const same =
          next.length === entries.length &&
          next.every((entry, index) => {
            const before = entries[index];
            return (
              before !== undefined &&
              entry.path === before.path &&
              entry.name === before.name &&
              entry.kind === before.kind
            );
          });
        // re-publishing an identical listing rebuilds the wiki resolver and re-renders the tree.
        if (same) {
          return;
        }
        entries = next;
        ports.publishListing(next);
      } catch {
        // keep the last-known listing on a transient failure.
      }
    })();
  };

  const editNote = (path: string, next: string): void => {
    if (runtime?.path !== path) {
      return;
    }
    runtime.edit(next);
  };

  const registerNoteSerializeFlush = (path: string, preFlush: () => void): void => {
    if (runtime?.path !== path) {
      return;
    }
    runtime.registerPreFlush(preFlush);
  };

  const createFileAt = async (rawPath: string, seedContent = ""): Promise<string | null> => {
    const trimmed = rawPath.trim();
    if (trimmed === "") {
      return null;
    }
    const verdict = validNotePath(withDefaultExtension(trimmed));
    if (!verdict.ok) {
      ports.notify(verdict.message);
      return null;
    }
    const { path } = verdict;
    // an existing file opens with no notice; the create below is exclusive, so a file landing
    // between this check and the create is refused rather than overwritten.
    if (await ports.exists(path)) {
      return path;
    }
    const created = await ports.note
      .create(path, seedContent)
      .then(() => true)
      .catch(() => false);
    if (!created) {
      ports.notify(`Couldn't create ${path}.`);
      return null;
    }
    refreshList();
    return path;
  };

  const createFile = async (rawPath: string, content = ""): Promise<void> => {
    const path = await createFileAt(rawPath, content);
    if (path !== null) {
      openFile(path);
    }
  };

  const renameEntry = async (from: string, to: string): Promise<boolean> => {
    const dest = to.trim();
    if (dest === "" || dest === from) {
      return true;
    }
    const wasOpen = openPath === from;
    // flush first so an in-flight write of `from` can't recreate it post-move.
    if (wasOpen && !(await flush())) {
      ports.notify("Couldn't save the file — resolve that before renaming.");
      return false;
    }
    // dispose before the call: the rename's own broadcast otherwise reaches a controller still
    // on `from`, which reloads the moved file and closes the note being carried over.
    if (wasOpen) {
      disposeRuntime();
    }
    const result = await ports.rename(from, dest).catch(() => null);
    if (result === null || !result.ok) {
      ports.notify(result?.ok === false ? result.error : "Couldn't rename the file.");
      // the file never moved: re-attach a controller to the still-open note.
      if (wasOpen && openPath === from) {
        ensureRuntime(from);
      }
      return false;
    }
    refreshList();
    if (wasOpen && openPath === from) {
      ensureRuntime(dest);
      applyOpenPath(dest, "carry");
    }
    return true;
  };

  const deleteEntry = async (path: string): Promise<void> => {
    const open = runtime?.path === path ? runtime : null;
    // null is a delete that threw: the file's fate is unknown, so the note stays open over it.
    const outcome =
      open === null ? await ports.note.remove(path).catch(() => null) : await open.remove();
    if (outcome === null) {
      ports.notify(`Couldn't delete ${path}.`);
    } else if (open !== null) {
      dropNote(path);
    }
    refreshList();
  };

  const handleVaultChanged = (event: VaultChangedEvent): void => {
    if (openPath !== null && vaultChangeTouches(event, openPath)) {
      runtime?.controller.externalChange();
    }
    // a content write moves no row, so an autosave costs no walk; a files event always re-lists,
    // since a path it names may have left the vault as easily as joined it.
    if (event.kind === "files") {
      refreshList();
    }
  };

  return {
    actions: {
      createFile,
      createFileAt,
      deleteEntry,
      editNote,
      flush,
      openFile,
      registerNoteSerializeFlush,
      renameEntry,
    },

    handleVaultChanged,

    start: async (): Promise<void> => {
      running = true;
      try {
        const boot = await ports.boot();
        if (!running) {
          return;
        }
        ({ entries } = boot);
        ports.publishListing(boot.entries);
        // a click or deep link can beat the boot; never open over a note already open.
        if (boot.openNote !== null && runtime === null) {
          ensureRuntime(boot.openNote.path, boot.openNote.content);
          applyOpenPath(boot.openNote.path);
        }
      } catch {
        // the socket's supervisor reconnects and the next refresh re-lists.
      }
    },

    stop: (): void => {
      running = false;
      // flush first: a change inside the autosave debounce would go with the timer dispose cancels.
      void runtime?.flush();
      disposeRuntime();
    },
  };
};
