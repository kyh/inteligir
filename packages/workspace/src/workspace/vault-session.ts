// ---------------------------------------------------------------------------
// The open note's ORDERING, in one place that can be driven without React.
//
// Everything this composes is tested on its own — the note runtime's debounce
// and vanish watcher, the editor controller's read/write races, the open-note
// store's gate analysis. What NOTHING else owns is the order the calls go in,
// and every rule below is one that produced a bug when it was implicit:
//
//   • A rename disposes the old runtime BEFORE the bridge call. The rename's
//     own vault-changed broadcast otherwise reaches a controller still pointed
//     at the source path, which reloads a file that has moved, lands on
//     `path: null`, and trips the vanish watcher — closing the very note being
//     carried over.
//   • A failed flush REFUSES to navigate. Edits that would not save are worth
//     more than the click.
//   • Overlapping listings apply in issue order, never arrival order.
//   • A root switch drops the open note: its relative path belongs to the old
//     vault.
//   • The boot bundle never opens a note over one already open. A deep link or
//     a click can beat the boot, and a runtime that exists is one somebody
//     chose.
//   • Construction is INERT. Nothing subscribes, schedules or fetches until
//     `start()`, so React 19's double-invoked initializer can build one and
//     throw it away, and `stop()` leaves a session that can start again.
//
// The session holds its own state rather than React refs: every rule above is
// a synchronous read-then-write across an await, which is exactly what render
// timing is free to reorder. `vault-context.tsx` is the React wiring over this.
// ---------------------------------------------------------------------------

import type { ResultOf } from "@repo/bridge/ipc-contract";
import {
  heldDeletionMessage,
  vaultChangeTouches,
  type DeleteVaultEntryResult,
  type VaultChangedEvent,
  type VaultEntry,
  type WorkspaceBoot,
} from "@repo/bridge/vault";
import type { VaultActions } from "@repo/editor/host";
import type { OpenPathChange } from "@repo/editor/note/open-note-store";
import { createNoteRuntime, type NoteRuntime } from "@repo/editor/note/note-runtime";
import type { VaultEditorState, VaultIO } from "@repo/editor/vault-editor";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { basenamePath, dirnamePath } from "@repo/notes/knowledge/vault-path";

/** How the user is told about something the session could not do. `error` is a
 * failure; `warning` is a refusal that left the file exactly where it was. */
export type NoticeLevel = "error" | "warning";

export type VaultSessionPorts = {
  // ---- what the session asks of the vault --------------------------------
  /** The whole first paint in one invoke: root, listing, and the bytes of the
   * note ui-state says was open. */
  boot: () => Promise<WorkspaceBoot>;
  /** Re-query the listing. */
  list: () => Promise<VaultEntry[]>;
  /** Ask the host to re-announce its manifest. */
  refresh: () => Promise<void>;
  /** Whether `path` already names a document — open-or-create never truncates
   * a note the user already has. */
  exists: (path: string) => Promise<boolean>;
  /** Move a file, answering with the host's verdict. */
  rename: (from: string, to: string) => Promise<ResultOf<"renameVaultEntry">>;
  /** Read, write and delete. The open note's runtime acts through this, and so
   * do the writes and deletes that never open one. */
  note: VaultIO;

  // ---- what the session publishes ----------------------------------------
  /** The listing changed structurally (a path arrived or left). */
  publishListing: (entries: VaultEntry[]) => void;
  /** The vault root changed. */
  publishRoot: (root: string) => void;
  /** The note the UI now intends open. Both exposing it and REMEMBERING it —
   * the next boot resolves its bytes from the same answer. `change` separates
   * a navigation from a rename carrying the open note to its new path — the
   * two mean different things to navigation history. */
  publishOpenPath: (path: string | null, change: OpenPathChange) => void;
  /** The open note's live editor state, on every emission the controller
   * makes. Synchronous with the emission, so a keystroke's value lands in the
   * same event flush. */
  publishEditor: (state: VaultEditorState) => void;

  // ---- what the session asks of the shell --------------------------------
  /** Bring the editor surface up. `openFile` always does this: a note opened
   * from the graph or the tasks view has to show the note. */
  showEditor: () => void;
  notify: (level: NoticeLevel, message: string) => void;
  /**
   * Settle a pending AI suggestion session on `path`, answering with the bytes
   * that should be persisted (null when there is none).
   *
   * Reject-all reverts only the suggestion-marked ranges, so typing the user
   * interleaved during the review survives while the AI marks disappear —
   * without it a flush writes the frozen pre-session buffer and the typing dies
   * with the unmounting editor.
   */
  settleAiSession: (path: string) => string | null;
};

export type VaultSession = {
  /**
   * Everything the workspace and the editor may ask of the vault.
   *
   * Identity is fixed for the session's life, which is the cadence contract
   * `EditorHostProvider` is handed: a consumer that only ACTS never re-renders
   * from vault state at all.
   */
  readonly actions: VaultActions;
  /** Fetch the boot bundle and open what it names. Safe to call again after
   * `stop()`; a boot that lands on a stopped session applies nothing. */
  start: () => Promise<void>;
  /** Persist pending edits and tear the runtime down. */
  stop: () => void;
  /** A vault broadcast from the host. */
  handleVaultChanged: (event: VaultChangedEvent) => void;
};

/** Append the default `.md` extension unless `name` already ends in one (any
 * lowercase-alphanumeric extension). `name` is assumed already trimmed. */
function withDefaultExtension(name: string): string {
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.md`;
}

/** Gate a to-be-created path's basename through checkNoteName (directory
 * segments pass through — `notes/foo` is intentional foldering here, unlike a
 * `/` typed into the h1 title). */
function validNotePath(path: string): { ok: true; path: string } | { ok: false; message: string } {
  const verdict = checkNoteName(basenamePath(path));
  if (!verdict.ok) return { ok: false, message: noteNameErrorMessage(verdict.reason) };
  const dir = dirnamePath(path);
  return { ok: true, path: dir === "" ? verdict.name : `${dir}/${verdict.name}` };
}

/** Whether a vault broadcast changed the sidebar's own rows: a path arriving or
 * leaving. A change the host could not describe moves it by definition. */
function movesTheListing(event: VaultChangedEvent, entries: readonly VaultEntry[]): boolean {
  const { changed } = event;
  if (changed === null) return true;
  if (changed.removed.length > 0) return true;
  const known = new Set(entries.map((entry) => entry.path));
  return changed.upserted.some((path) => !known.has(path));
}

export function createVaultSession(ports: VaultSessionPorts): VaultSession {
  let running = false;
  let root = "";
  let entries: VaultEntry[] = [];
  let openPath: string | null = null;
  let runtime: NoteRuntime | null = null;
  // The session's own subscription publishing this runtime's controller
  // emissions — separate from the runtime's internal vanish watcher, so
  // disposing must clear both.
  let unpublish: (() => void) | null = null;
  // Ordering token: overlapping listings (a boot racing a broadcast, or two
  // rapid broadcasts) apply in issue order, so a slow one can never land over
  // a newer one.
  let listSeq = 0;

  function applyOpenPath(next: string | null, change: OpenPathChange = "navigate"): void {
    if (next === openPath) return;
    openPath = next;
    ports.publishOpenPath(next, change);
  }

  function disposeRuntime(): void {
    unpublish?.();
    unpublish = null;
    runtime?.dispose();
    runtime = null;
  }

  /** Drop the open note without flushing — the file is already gone (external
   * delete, unreadable restore) or explicitly deleted. */
  function dropNote(path: string): void {
    if (runtime?.path !== path) return;
    disposeRuntime();
    applyOpenPath(null);
  }

  /** Create the runtime for a note and start loading its file. Any previous
   * runtime must already be disposed — every caller below owns that ordering.
   * `initial` opens the note from bytes the caller already holds. */
  function ensureRuntime(path: string, initial?: string): NoteRuntime {
    if (runtime?.path === path) return runtime;
    const created = createNoteRuntime(path, root, ports.note, { onVanished: dropNote }, initial);
    runtime = created;
    // Subscribe BEFORE the first publish, so no emission can slip between the
    // snapshot and the subscription.
    const publish = (): void => ports.publishEditor(created.controller.getState());
    unpublish = created.controller.subscribe(publish);
    publish();
    return created;
  }

  /** Flush the open note's pending edits (clearing the debounce). True when
   * clean. A pending AI suggestion session is settled into the buffer first. */
  async function flush(): Promise<boolean> {
    const current = runtime;
    if (current === null) return true;
    const settled = ports.settleAiSession(current.path);
    if (settled !== null && settled !== current.controller.getState().content) {
      current.controller.edit(settled);
    }
    return current.flush();
  }

  function openFile(path: string): void {
    void (async () => {
      ports.showEditor();
      if (openPath === path) return;
      if (!(await flush())) {
        ports.notify("error", "Couldn't save the current file — resolve that before switching.");
        return;
      }
      disposeRuntime();
      ensureRuntime(path);
      applyOpenPath(path);
    })();
  }

  function refreshList(): void {
    const seq = ++listSeq;
    void (async () => {
      try {
        const next = await ports.list();
        if (seq !== listSeq) return;
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
        // Most broadcasts move no row at all, and re-publishing an identical
        // listing rebuilds the wiki resolver and re-renders the whole tree.
        if (same) return;
        entries = next;
        ports.publishListing(next);
      } catch {
        // Best-effort — keep the last-known listing on a transient failure.
      }
    })();
  }

  function editNote(path: string, next: string): void {
    if (runtime?.path !== path) return;
    runtime.edit(next);
  }

  function registerNoteSerializeFlush(path: string, preFlush: () => void): void {
    if (runtime?.path !== path) return;
    runtime.registerPreFlush(preFlush);
  }

  async function createFileAt(rawPath: string, seedContent = ""): Promise<string | null> {
    const trimmed = rawPath.trim();
    if (trimmed === "") return null;
    const verdict = validNotePath(withDefaultExtension(trimmed));
    if (!verdict.ok) {
      ports.notify("error", verdict.message);
      return null;
    }
    const path = verdict.path;
    // Don't truncate an existing file — it already satisfies "exists".
    // Open-or-create seeds only when the file is genuinely new, so a second
    // "open today's note" reopens the existing note byte-for-byte.
    if (await ports.exists(path)) return path;
    const created = await ports.note
      .write(path, seedContent)
      .then(() => true)
      .catch(() => false);
    if (!created) {
      ports.notify("error", `Couldn't create ${path}.`);
      return null;
    }
    refreshList();
    return path;
  }

  async function createFile(rawPath: string, content = ""): Promise<void> {
    const path = await createFileAt(rawPath, content);
    if (path !== null) openFile(path);
  }

  async function renameEntry(from: string, to: string): Promise<boolean> {
    const dest = to.trim();
    if (dest === "" || dest === from) return true; // nothing to do
    const wasOpen = openPath === from;
    // Flush first so an in-flight write of `from` can't recreate it post-move.
    if (wasOpen && !(await flush())) {
      ports.notify("error", "Couldn't save the file — resolve that before renaming.");
      return false;
    }
    // Then DISPOSE, before the call: the rename's own broadcast otherwise
    // reaches a controller still pointed at `from`, which reloads a file that
    // has moved and closes the note this rename is carrying over.
    if (wasOpen) disposeRuntime();
    const result = await ports.rename(from, dest).catch(() => null);
    if (result === null || !result.ok) {
      ports.notify("error", result?.ok === false ? result.error : "Couldn't rename the file.");
      // The file never moved — re-attach a controller to the still-open note.
      if (wasOpen && openPath === from) ensureRuntime(from);
      return false;
    }
    refreshList();
    // Carry the open note to the new path: a fresh controller reading the moved
    // file (the old one was flushed and disposed above).
    if (wasOpen && openPath === from) {
      ensureRuntime(dest);
      applyOpenPath(dest, "carry");
    }
    return true;
  }

  // Every delete answers the same way, whether or not the file is the one open.
  // A swallowed failure just silently reappears the row on the next listing. A
  // HELD delete is neither failure nor success: the file is still there on
  // purpose, and the gate's own sentence says why.
  function reportDeletion(path: string, outcome: DeleteVaultEntryResult | null): void {
    if (outcome === null) ports.notify("error", `Couldn't delete ${path}.`);
    else if (outcome.outcome === "held") ports.notify("warning", heldDeletionMessage(outcome.held));
  }

  async function deleteEntry(path: string): Promise<void> {
    if (runtime?.path === path) {
      // The runtime clears its own buffer only when the file actually went; the
      // explicit drop is an idempotent backstop for the same condition, so a
      // HELD delete leaves the note open over the file that is still there.
      const outcome = await runtime.remove();
      if (outcome !== null && outcome.outcome !== "held") dropNote(path);
      reportDeletion(path, outcome);
    } else {
      const outcome = await ports.note.remove(path).catch(() => null);
      reportDeletion(path, outcome);
    }
    refreshList();
  }

  function refreshVault(): void {
    ports.refresh().catch(() => {});
  }

  function handleVaultChanged(event: VaultChangedEvent): void {
    const nextRoot = event.root;
    const switched = root !== "" && nextRoot !== root;
    root = nextRoot;
    ports.publishRoot(nextRoot);
    if (switched) {
      // The open note's path belongs to the vault that just went away.
      disposeRuntime();
      applyOpenPath(null);
      refreshList();
      return;
    }
    // The root is adopted either way; only the RELOAD is conditional.
    runtime?.controller.setRoot(nextRoot);
    if (openPath !== null && vaultChangeTouches(event, openPath)) {
      runtime?.controller.externalChange(nextRoot);
    }
    // A write that only changed a file's CONTENT leaves every sidebar row
    // identical, and re-listing anyway costs a round trip per autosave on every
    // open client.
    if (movesTheListing(event, entries)) refreshList();
  }

  return {
    actions: {
      openFile,
      editNote,
      registerNoteSerializeFlush,
      createFile,
      createFileAt,
      renameEntry,
      deleteEntry,
      flush,
      refreshVault,
    },

    start: async (): Promise<void> => {
      running = true;
      try {
        const boot = await ports.boot();
        if (!running) return;
        root = boot.root;
        ports.publishRoot(boot.root);
        runtime?.controller.setRoot(boot.root);
        entries = boot.entries;
        ports.publishListing(boot.entries);
        // Never over a note already open: a click or a deep link can beat the
        // boot, and a runtime that exists is one somebody chose.
        if (boot.openNote !== null && runtime === null) {
          ensureRuntime(boot.openNote.path, boot.openNote.content);
          applyOpenPath(boot.openNote.path);
        }
      } catch {
        // The socket's supervisor reconnects and the next refresh re-lists; an
        // empty sidebar is the honest interim state.
      }
    },

    stop: (): void => {
      running = false;
      // Persist first: a change still inside the autosave debounce would go
      // with the timer dispose cancels.
      void runtime?.flush();
      disposeRuntime();
    },

    handleVaultChanged,
  };
}
