// Construction is inert: nothing subscribes, schedules or fetches until `start()`,
// so React 19's double-invoked initializer can build one and discard it.

import { vaultChangeTouches } from "@repo/editor/host-io";
import type {
  CreateNewFileResult,
  VaultActions,
  VaultChangedEvent,
  VaultEntry,
} from "@repo/editor/host-io";
import type { OpenPathChange } from "@repo/editor/note/open-note-store";
import { createNoteRuntime } from "@repo/editor/note/note-runtime";
import type { NoteRuntime } from "@repo/editor/note/note-runtime";
import type { SaveError, VaultEditorState, VaultIO } from "@repo/editor/vault-editor";
import { isDocPath, withDocExtension } from "@repo/notes/knowledge/doc-file";
import { frontmatterId } from "@repo/notes/markdown/frontmatter";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { basenamePath, dirnamePath } from "@repo/notes/knowledge/vault-path";

export interface WorkspaceBoot {
  readonly entries: VaultEntry[];
  // read through `VaultSessionPorts.note`: the session opens the note on these bytes and reads
  // nothing itself, so bytes read around it leave the first save no base to guard it with
  readonly openNote: { readonly path: string; readonly content: string } | null;
}

export type RenameResult = { ok: true } | { ok: false; error: string };

export type VanishedChoice = "recreate" | "discard";

export interface VaultSessionPorts {
  boot: () => Promise<WorkspaceBoot>;
  list: () => Promise<VaultEntry[]>;
  rename: (from: string, to: string) => Promise<RenameResult>;
  note: VaultIO;
  publishListing: (entries: VaultEntry[]) => void;
  publishOpenPath: (path: string | null, change: OpenPathChange) => void;
  publishEditor: (state: VaultEditorState) => void;
  notify: (message: string) => void;
  // a save or a reload merged a change made elsewhere and kept this note's lines where both
  // changed the same ones.
  notifyMergeConflict: (path: string) => void;
  // asked when the user leaves a note whose file was deleted under unsaved edits.
  askVanished: (path: string) => Promise<VanishedChoice>;
  // where the item whose frontmatter `id` this is lives now, asked when the open item's file
  // vanished under a clean buffer: a move the page did not make (a fill's rename, an agent's
  // rename) is followed rather than dropped to the library. Unset, a vanish closes the item.
  findMoved?: (path: string, id: string) => Promise<string | null>;
}

export interface VaultSession {
  // identity is fixed for the session's life: a consumer that only acts never re-renders.
  readonly actions: VaultActions;
  // safe to call again after `stop()`.
  start: () => Promise<void>;
  stop: () => void;
  handleVaultChanged: (event: VaultChangedEvent) => void;
}

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

const isWithin = (path: string, entry: string): boolean =>
  path === entry || path.startsWith(`${entry}/`);

// where the open note lands when `from` moves to `to`: `from` is the note itself or a folder above it.
const carriedNote = (
  open: string | null,
  from: string,
  to: string,
): { readonly from: string; readonly to: string } | null =>
  open !== null && isWithin(open, from)
    ? { from: open, to: `${to}${open.slice(from.length)}` }
    : null;

const saveErrorMessage = (path: string, error: SaveError): string =>
  error.kind === "vanished"
    ? `${path} was deleted elsewhere, and its edits are not saved.`
    : `Couldn't save ${path}: ${error.message}. Retrying.`;

export const createVaultSession = (ports: VaultSessionPorts): VaultSession => {
  let running = false;
  let entries: VaultEntry[] = [];
  let openPath: string | null = null;
  let runtime: NoteRuntime | null = null;
  // separate from the runtime's own vanish watcher; disposing must clear both.
  let unpublish: (() => void) | null = null;
  // overlapping listings apply in issue order, never arrival order.
  let listSeq = 0;
  // the latest openFile wins: one issued while an earlier one waits on its flush supersedes it,
  // a return to the note already open included.
  let navSeq = 0;

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

  // the bytes the open runtime last held, read for its frontmatter id only once its file is gone
  let lastContent: string | null = null;
  // the runtime this session is deleting itself, whose vanish is the delete's and not a move
  let removing: NoteRuntime | null = null;
  // what a runtime's vanish runs, bound once the follow below exists: it opens runtimes itself
  let onRuntimeVanished: (path: string) => void = dropNote;

  // the delete of the open runtime, marked so its vanish is not followed as a move
  const removeOpen = async (target: NoteRuntime): Promise<boolean> => {
    removing = target;
    try {
      return await target.remove();
    } finally {
      removing = null;
    }
  };

  // callers dispose any previous runtime first.
  const ensureRuntime = (path: string, initial?: string): NoteRuntime => {
    if (runtime?.path === path) {
      return runtime;
    }
    const created = createNoteRuntime(
      path,
      ports.note,
      {
        onMergeConflict: ports.notifyMergeConflict,
        onVanished: (gone) => {
          onRuntimeVanished(gone);
        },
      },
      initial,
    );
    runtime = created;
    lastContent = initial ?? null;
    // said once per failure, not per retry: the error stands until a write lands.
    let failing: SaveError["kind"] | null = null;
    // subscribe before the first publish so no emission slips between snapshot and subscription.
    const publish = (): void => {
      const state = created.getState();
      if (state.kind === "open" && runtime === created) {
        lastContent = state.content;
      }
      ports.publishEditor(state);
      const saveError = state.kind === "open" ? state.saveError : null;
      if (saveError !== null && saveError.kind !== failing) {
        ports.notify(saveErrorMessage(created.path, saveError));
      }
      failing = saveError?.kind ?? null;
    };
    unpublish = created.subscribe(publish);
    publish();
    return created;
  };

  // a clean buffer whose file left: an item that carries an id is looked for where it went, and
  // opened there in place of the old path, so Back never names it; only an id nothing answers to,
  // or a navigation made while the answer was in flight, leaves it closed.
  const followVanished = (path: string): void => {
    const vanished = runtime;
    if (vanished?.path !== path) {
      return;
    }
    const id = lastContent === null || removing === vanished ? null : frontmatterId(lastContent);
    const { findMoved } = ports;
    if (id === null || findMoved === undefined) {
      dropNote(path);
      return;
    }
    disposeRuntime();
    const seq = navSeq;
    void (async () => {
      const moved = await findMoved(path, id).catch(() => null);
      if (!running || seq !== navSeq || runtime !== null || openPath !== path) {
        return;
      }
      if (moved === null || moved === path) {
        applyOpenPath(null);
        return;
      }
      ensureRuntime(moved);
      applyOpenPath(moved, "carry");
    })();
  };

  onRuntimeVanished = followVanished;

  const flush = async (): Promise<boolean> => {
    const current = runtime;
    if (current === null) {
      return true;
    }
    return await current.flush();
  };

  // a note deleted under unsaved edits can never save, so refusing the switch would hold the user
  // on it for good: the host asks whether to write it back or let the edits go.
  const releaseVanished = async (leaving: NoteRuntime): Promise<boolean> => {
    const choice = await ports.askVanished(leaving.path);
    if (runtime !== leaving) {
      return false;
    }
    if (choice === "discard" || (await leaving.recreate())) {
      return true;
    }
    ports.notify(`Couldn't re-create ${leaving.path}.`);
    return false;
  };

  // `null` is the library: the item is written and let go, as a switch to another would.
  const navigate = (path: string | null): void => {
    navSeq += 1;
    const seq = navSeq;
    if (openPath === path) {
      return;
    }
    void (async () => {
      const leaving = runtime;
      if (!(await flush())) {
        if (seq !== navSeq) {
          return;
        }
        const left = leaving?.getState();
        if (leaving === null || left?.kind !== "open" || left.saveError?.kind !== "vanished") {
          ports.notify("Couldn't save the current file — resolve that before switching.");
          return;
        }
        if (!(await releaseVanished(leaving))) {
          return;
        }
      }
      if (seq !== navSeq) {
        return;
      }
      disposeRuntime();
      // a file that is no doc (an image, a PDF) is shown, never read as text into a buffer
      if (path !== null && isDocPath(path)) {
        ensureRuntime(path);
      }
      applyOpenPath(path);
    })();
  };

  const openFile = (path: string): void => {
    navigate(path);
  };

  const closeFile = (): void => {
    navigate(null);
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

  // the create is exclusive, so a file already at the path is answered, never overwritten.
  const createNewFileAt = async (
    rawPath: string,
    seedContent: string,
  ): Promise<CreateNewFileResult> => {
    const trimmed = rawPath.trim();
    if (trimmed === "") {
      return { kind: "refused" };
    }
    const verdict = validNotePath(withDocExtension(trimmed));
    if (!verdict.ok) {
      ports.notify(verdict.message);
      return { kind: "refused" };
    }
    const { path } = verdict;
    const outcome = await ports.note.create(path, seedContent).catch(() => null);
    if (outcome === null) {
      ports.notify(`Couldn't create ${path}.`);
      return { kind: "refused" };
    }
    if (outcome.kind === "exists") {
      return { kind: "exists", path };
    }
    refreshList();
    return { kind: "created", path };
  };

  // an existing file answers its path with no notice.
  const createFileAt = async (rawPath: string, seedContent = ""): Promise<string | null> => {
    const result = await createNewFileAt(rawPath, seedContent);
    return result.kind === "refused" ? null : result.path;
  };

  const createFile = async (rawPath: string): Promise<void> => {
    const path = await createFileAt(rawPath);
    if (path !== null) {
      openFile(path);
    }
  };

  const renameEntry = async (from: string, to: string): Promise<boolean> => {
    const dest = to.trim();
    if (dest === "" || dest === from) {
      return true;
    }
    const carry = carriedNote(openPath, from, dest);
    // flush first so an in-flight write of the open note can't recreate it post-move.
    if (carry !== null && !(await flush())) {
      ports.notify("Couldn't save the open item — resolve that before renaming.");
      return false;
    }
    // held, not let go: a keystroke typed during the move needs a buffer to land in, and the
    // move's own broadcast would otherwise reload the moved file and close the note being carried.
    const carried = carry === null ? null : runtime;
    carried?.suspend();
    const result = await ports.rename(from, dest).catch(() => null);
    if (result === null || !result.ok) {
      ports.notify(result?.ok === false ? result.error : "Couldn't rename the file.");
      if (carry !== null) {
        void carried?.resume(carry.from);
      }
      return false;
    }
    refreshList();
    if (carry !== null && carried !== null) {
      void carried.resume(carry.to);
      if (runtime === carried) {
        applyOpenPath(carry.to, "carry");
      }
    }
    return true;
  };

  const deleteEntry = async (path: string): Promise<void> => {
    const open = runtime !== null && isWithin(runtime.path, path) ? runtime : null;
    // a folder delete that fails leaves the note under it open, so its edits are written first.
    if (open !== null && open.path !== path) {
      await flush();
    }
    // a delete that threw leaves the file's fate unknown, so the note stays open over it.
    const removed =
      open?.path === path
        ? await removeOpen(open)
        : await ports.note.remove(path).then(
            () => true,
            () => false,
          );
    if (!removed) {
      ports.notify(`Couldn't delete ${path}.`);
    } else if (open !== null) {
      dropNote(open.path);
    }
    refreshList();
  };

  const handleVaultChanged = (event: VaultChangedEvent): void => {
    if (openPath !== null && vaultChangeTouches(event, openPath)) {
      runtime?.externalChange();
    }
    // a content write moves no row, so an autosave costs no walk; a files event always re-lists,
    // since a path it names may have left the vault as easily as joined it.
    if (event.kind === "files") {
      refreshList();
    }
  };

  return {
    actions: {
      closeFile,
      createFile,
      createFileAt,
      createNewFileAt,
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
