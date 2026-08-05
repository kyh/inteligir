import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { toast } from "@repo/ui/components/sonner";

import { docExists, getBridge } from "@repo/bridge/client";
import { createDebouncer } from "@repo/editor/lib/debounce";
import {
  EditorHostProvider,
  type EditorHost,
  type VaultActions,
  type VaultListing,
} from "@repo/editor/host";
import { ConnectionsPanel } from "@repo/workspace/workspace/connections-panel";
import { hasTransientSuggestions } from "@repo/editor/ai/suggestions";
import { hasTransientAiState } from "@repo/editor/ai/transient";
import { settleTransients } from "@repo/editor/ai/transient-settle";
import {
  registerOpenNoteFlush,
  registerOpenNotePath,
  registerOpenNotePrivacy,
} from "@repo/editor/note/open-note-flush";
import { notePrivacy } from "@repo/notes/markdown/frontmatter";
import { getLiveEditor } from "@repo/editor/live-editor";
import { createCaptureApplier, insertCaptureLine } from "@repo/workspace/workspace/capture-apply";
import { type NoteRuntime, createNoteRuntime } from "@repo/editor/note/note-runtime";
import {
  publishEditor,
  publishOpenPath,
  setOpenNoteMode,
  showOpenHtmlAsApp,
  showOpenHtmlAsText,
} from "@repo/editor/note/open-note-store";
import { type VaultIO } from "@repo/editor/vault-editor";
import { useUiStateStore } from "@repo/workspace/stores/ui-state-store";
import { useViewStore } from "@repo/workspace/stores/view-store";
import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import { checkNoteName, noteNameErrorMessage } from "@repo/notes/knowledge/note-name";
import { basenamePath, dirnamePath } from "@repo/notes/knowledge/vault-path";

import type { VaultEntry } from "@repo/bridge/ipc-registry";

/** ui-state key the open note persists under (restored on boot). */
const OPEN_NOTE_KEY = "workspace.openNote";

/** Debounce window-focus → vault refresh so a flurry of focus/blur (alt-tab,
 * dialogs) coalesces into one snapshot rebuild (vault liveness — CLAUDE.md
 * § Decisions). */
const FOCUS_REFRESH_DEBOUNCE_MS = 1000;

/**
 * Append the default `.md` extension unless `name` already ends in one (any
 * lowercase-alphanumeric extension). `name` is assumed already trimmed.
 */
function withDefaultExtension(name: string): string {
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.md`;
}

/** Gate a to-be-created path's basename through checkNoteName (directory
 * segments pass through — `notes/foo` is intentional foldering here, unlike a
 * `/` typed into the h1 title). Returns the path with the NFC-normalized
 * basename, or null after a rejection toast. */
function validNotePath(path: string): string | null {
  const verdict = checkNoteName(basenamePath(path));
  if (!verdict.ok) {
    toast.error(noteNameErrorMessage(verdict.reason));
    return null;
  }
  const dir = dirnamePath(path);
  return dir === "" ? verdict.name : `${dir}/${verdict.name}`;
}

// IO the editor controller acts through — thin wrappers over the bridge so the
// controller stays bridge-agnostic and unit-testable.
const VAULT_IO: VaultIO = {
  read: (path) => getBridge().readVaultDoc({ path }),
  write: (path, content) => getBridge().writeVaultDoc({ path, content }),
  remove: (path) =>
    getBridge()
      .deleteVaultEntry({ path })
      .then(() => undefined),
};

// ---------------------------------------------------------------------------
// This provider PRODUCES the vault state; @repo/editor/host declares its shape
// and owns the contexts. Three exposure seams, split by change CADENCE so a
// keystroke re-renders only what depends on the open note's content:
// - useVaultActions — the stable callbacks (identity never changes).
//   Consumers that only ACT (wiki chips, palette actions, sidebar handlers)
//   never re-render from vault state at all.
// - useVaultListing — entries + folderName + resolveWikiTarget; changes
//   only on a structural refresh (or when the wiki resolver rebuilds).
// - useOpenNote (@repo/editor/note/open-note-store) — the high-cadence
//   open-note slice, subscribed via selectors.
// ---------------------------------------------------------------------------

export function VaultProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [root, setRoot] = useState("");
  const rootRef = useRef("");

  // ---- Open note -----------------------------------------------------------
  // The ref is the source of truth every operation reads and writes
  // SYNCHRONOUSLY; the open-note store is its exposure mirror. Keeping
  // mutations out of setState updaters keeps them single-shot under
  // StrictMode's double-invoke.
  const openPathRef = useRef<string | null>(null);
  const runtimeRef = useRef<NoteRuntime | null>(null);
  // The provider's own subscription publishing this runtime's controller
  // emissions into the open-note store (separate from the runtime's internal
  // vanish watcher — dispose must clear both).
  const runtimeSubRef = useRef<(() => void) | null>(null);
  const setUiState = useUiStateStore((s) => s.set);
  const uiLoaded = useUiStateStore((s) => s.loaded);

  const applyOpenPath = useCallback(
    (next: string | null) => {
      if (next === openPathRef.current) return;
      openPathRef.current = next;
      publishOpenPath(next);
      setUiState(OPEN_NOTE_KEY, next);
      // Point the host's single open-note watcher at the new file (or clear it).
      // This is the only file watched for external edits (vault liveness —
      // CLAUDE.md § Decisions).
      getBridge()
        .setWatchedNote({ path: next })
        .catch(() => {});
    },
    [setUiState],
  );

  const disposeRuntime = useCallback(() => {
    runtimeSubRef.current?.();
    runtimeSubRef.current = null;
    runtimeRef.current?.dispose();
    runtimeRef.current = null;
  }, []);

  /** Drop the open note without flushing — the file is already gone (external
   * delete, unreadable restore) or explicitly deleted. */
  const dropNote = useCallback(
    (path: string) => {
      if (runtimeRef.current?.path !== path) return;
      disposeRuntime();
      applyOpenPath(null);
    },
    [applyOpenPath, disposeRuntime],
  );

  /** Create the runtime for a note and start loading its file. Any previous
   * runtime must already be disposed (openFile owns that ordering). */
  const ensureRuntime = useCallback(
    (path: string): NoteRuntime => {
      const existing = runtimeRef.current;
      if (existing?.path === path) return existing;
      const runtime = createNoteRuntime(path, rootRef.current, VAULT_IO, {
        onVanished: dropNote,
      });
      runtimeRef.current = runtime;
      // Publish this runtime's controller emissions into the open-note store —
      // synchronously with each emission, so a keystroke's value lands in the
      // same event flush (see open-note-store.ts). Subscribe BEFORE the first
      // publish so no emission can slip between snapshot and subscription.
      const publish = () => publishEditor(runtime.controller.getState());
      runtimeSubRef.current = runtime.controller.subscribe(publish);
      publish();
      return runtime;
    },
    [dropNote],
  );

  /** Flush the open note's pending edits (clearing the debounce). True when
   * clean. A pending AI suggestion session on the file is settled first:
   * reject-all reverts only the suggestion-marked ranges, so typing
   * the user interleaved during the review persists while the AI marks
   * disappear — without this, the flush would write the frozen pre-session
   * buffer and the typing would die with the unmounting editor. */
  const flushCurrent = useCallback(async (): Promise<boolean> => {
    const runtime = runtimeRef.current;
    if (!runtime) return true;
    const settled = settleTransients(runtime.path);
    if (settled !== null && settled !== runtime.controller.getState().content) {
      runtime.controller.edit(settled);
    }
    return runtime.flush();
  }, []);

  const openFile = useCallback(
    (path: string) => {
      void (async () => {
        // Navigation always lands on the editor surface — opening a note from
        // the graph, palette, or a wiki chip must show the note, not stay on
        // whatever surface was up.
        useViewStore.getState().setSurface("editor");
        if (openPathRef.current === path) return;
        // Flush the current note first, and refuse to navigate away from
        // edits that won't save (same contract as before).
        if (!(await flushCurrent())) {
          toast.error("Couldn't save the current file — resolve that before switching.");
          return;
        }
        disposeRuntime();
        ensureRuntime(path);
        applyOpenPath(path);
      })();
    },
    [applyOpenPath, disposeRuntime, ensureRuntime, flushCurrent],
  );

  // Ordering token so overlapping list calls (initial load + onVaultChanged, or
  // rapid vault events) can't land out of order — only the latest applies.
  const listSeq = useRef(0);
  // Last-applied listing, in a ref so the async callback compares against the
  // truly latest value (React state would be a stale closure). Every vault
  // broadcast re-fetches the listing — focus refreshes, delegation completion,
  // external open-note edits (autosaves went silent with the vault-liveness
  // model, CLAUDE.md § Decisions) — and most
  // of those don't change the listing, so skip the state set when nothing
  // structural changed to keep the sidebar tree from re-rendering on refocus.
  const lastEntriesRef = useRef<VaultEntry[]>([]);
  const refreshList = useCallback(() => {
    const bridge = getBridge();
    const seq = ++listSeq.current;
    void (async () => {
      try {
        const next = await bridge.listVault();
        if (seq !== listSeq.current) return;
        const prev = lastEntriesRef.current;
        const same =
          next.length === prev.length &&
          next.every((entry, i) => {
            const before = prev[i];
            return (
              before !== undefined &&
              entry.path === before.path &&
              entry.name === before.name &&
              entry.kind === before.kind
            );
          });
        if (same) return;
        lastEntriesRef.current = next;
        setEntries(next);
      } catch {
        // Best-effort — keep the last-known listing on a transient failure.
      }
    })();
  }, []);

  const editNote = useCallback((path: string, next: string) => {
    const runtime = runtimeRef.current;
    if (runtime?.path !== path) return;
    runtime.edit(next);
  }, []);

  const registerNoteSerializeFlush = useCallback((path: string, flush: () => void) => {
    const runtime = runtimeRef.current;
    if (runtime?.path !== path) return;
    runtime.registerPreFlush(flush);
  }, []);

  const createFileAt = useCallback(
    async (rawPath: string, seedContent = ""): Promise<string | null> => {
      const trimmed = rawPath.trim();
      if (!trimmed) return null;
      const path = validNotePath(withDefaultExtension(trimmed));
      if (path === null) return null;
      const bridge = getBridge();
      // Don't truncate an existing file — it already satisfies "exists".
      // Open-or-create seeds only when the file is genuinely new, so a second
      // "open today's note" reopens the existing note byte-for-byte.
      if (await docExists(bridge, path)) return path;
      const created = await bridge
        .writeVaultDoc({ path, content: seedContent })
        .then(() => true)
        .catch(() => false);
      if (!created) {
        toast.error(`Couldn't create ${path}.`);
        return null;
      }
      refreshList();
      return path;
    },
    [refreshList],
  );

  const createFile = useCallback(
    async (rawPath: string, content = "") => {
      const path = await createFileAt(rawPath, content);
      if (path !== null) openFile(path);
    },
    [createFileAt, openFile],
  );

  const renameEntry = useCallback(
    async (from: string, to: string): Promise<boolean> => {
      const dest = to.trim();
      if (!dest || dest === from) return true; // nothing to do
      const bridge = getBridge();
      const wasOpen = openPathRef.current === from;
      // Flush first so an in-flight write of `from` can't recreate it post-move.
      if (wasOpen && !(await flushCurrent())) {
        toast.error("Couldn't save the file — resolve that before renaming.");
        return false;
      }
      // Dispose `from`'s runtime BEFORE the bridge call: the rename's
      // vault-changed broadcast otherwise races the remap below — the old
      // controller reloads the now-missing source path, lands on path: null,
      // and the vanish watcher closes the very note we're carrying over.
      if (wasOpen) disposeRuntime();
      const result = await bridge.renameVaultEntry({ from, to: dest }).catch(() => null);
      if (!result || !result.ok) {
        toast.error(result?.ok === false ? result.error : "Couldn't rename the file.");
        // The file never moved — re-attach a controller to the still-open note.
        if (wasOpen && openPathRef.current === from) ensureRuntime(from);
        return false;
      }
      refreshList();
      // Carry the open note to the new path: a fresh controller reading the
      // moved file (the old one was flushed + disposed above).
      if (wasOpen && openPathRef.current === from) {
        ensureRuntime(dest);
        applyOpenPath(dest);
      }
      return true;
    },
    [applyOpenPath, disposeRuntime, ensureRuntime, flushCurrent, refreshList],
  );

  const deleteEntry = useCallback(
    async (path: string) => {
      const runtime = runtimeRef.current;
      if (runtime?.path === path) {
        // remove() emits path:null, which the vanish watcher turns into a
        // dropped note; the explicit drop below is an idempotent backstop.
        await runtime.remove();
        dropNote(path);
      } else {
        // Surface the failure (siblings createFileAt/renameEntry toast
        // theirs too) — a swallowed reject just silently reappears the row
        // after refreshList.
        const ok = await getBridge()
          .deleteVaultEntry({ path })
          .then(() => true)
          .catch(() => false);
        if (!ok) toast.error(`Couldn't delete ${path}.`);
      }
      refreshList();
    },
    [dropNote, refreshList],
  );

  const changeFolder = useCallback(async () => {
    if (!(await flushCurrent())) {
      toast.error("Couldn't save the open file — resolve that before switching folders.");
      return;
    }
    const result = await getBridge()
      .chooseVaultRoot()
      .catch(() => null);
    if (!result) return;
    if (!result.ok) {
      if (result.reason === "error") toast.error(result.error);
      return;
    }
    rootRef.current = result.root;
    setRoot(result.root);
    disposeRuntime();
    applyOpenPath(null);
    refreshList();
  }, [applyOpenPath, disposeRuntime, flushCurrent, refreshList]);

  const refreshVault = useCallback(() => {
    getBridge()
      .refreshVault()
      .catch(() => {});
  }, []);

  // Initial load: adopt the root + list files.
  useEffect(() => {
    getBridge()
      .getVaultRoot()
      .then((r) => {
        rootRef.current = r;
        setRoot(r);
        runtimeRef.current?.controller.setRoot(r);
        return undefined;
      })
      .catch(() => {});
    refreshList();
  }, [refreshList]);

  // Restore the persisted open note once ui-state has loaded — but never over
  // a note the user already opened while it was loading.
  const restored = useRef(false);
  useEffect(() => {
    if (!uiLoaded || restored.current) return;
    restored.current = true;
    if (openPathRef.current !== null) return;
    const stored = useUiStateStore.getState().values[OPEN_NOTE_KEY];
    if (typeof stored !== "string" || stored === "") return;
    ensureRuntime(stored);
    applyOpenPath(stored);
  }, [uiLoaded, ensureRuntime, applyOpenPath]);

  // Live updates: hand every vault-changed broadcast to the open note's
  // controller (reload or drop) and re-list the tree. A real root switch drops
  // the note — its relative path belongs to the old vault.
  useEffect(() => {
    return getBridge().onVaultChanged(({ root: nextRoot }) => {
      const switched = rootRef.current !== "" && nextRoot !== rootRef.current;
      rootRef.current = nextRoot;
      setRoot(nextRoot);
      if (switched) {
        disposeRuntime();
        applyOpenPath(null);
      } else {
        runtimeRef.current?.controller.externalChange(nextRoot);
      }
      refreshList();
    });
  }, [applyOpenPath, disposeRuntime, refreshList]);

  // External edits to files OTHER than the open note surface on window focus —
  // the ephemeral model's "the user refocuses to look" trade (vault liveness —
  // CLAUDE.md § Decisions). One
  // debounced refresh per focus flurry rebuilds the snapshot (re-list + reindex
  // + sync kick). The open note itself is covered live by the host's open-note
  // watcher, so this is about the rest of the vault.
  useEffect(() => {
    const refresh = createDebouncer(refreshVault, FOCUS_REFRESH_DEBOUNCE_MS);
    const onFocus = () => refresh.schedule();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      refresh.cancel();
    };
  }, [refreshVault]);

  // Persist on unmount so a change within the debounce window isn't lost, then
  // tear the runtime down — the manual controller subscription + vanish watcher
  // have no automatic teardown, so drop them explicitly (keeps StrictMode's
  // mount/unmount/mount cycle leak-free).
  useEffect(
    () => () => {
      void runtimeRef.current?.flush();
      disposeRuntime();
    },
    [disposeRuntime],
  );

  // Deep-link captures (inteligir://append|task) targeting the OPEN note are
  // routed INTO the live buffer — a host disk write would be skipped by the
  // dirty reload guard and clobbered by the next whole-buffer autosave. Rich
  // mode inserts through the live Plate editor (serialize → editNote carries
  // it); Raw mode appends via runtime.edit. Ack goes out only after a
  // confirmed flush; anything else ("not-open", a failed flush) hands the
  // entry back to the host's disk drain.
  useEffect(() => {
    const bridge = getBridge();
    const applier = createCaptureApplier({
      openPath: () => openPathRef.current,
      liveEditor: getLiveEditor,
      hasTransients: (editor) => hasTransientSuggestions(editor) || hasTransientAiState(editor),
      insertLine: insertCaptureLine,
      bufferContent: () => {
        // Loaded content only: while the controller is still reading the file
        // (state.path === null) an edit would no-op and a clean flush would
        // ack "applied" without persisting — report no buffer instead, so the
        // host's disk drain takes the capture and the reload shows it.
        const state = runtimeRef.current?.controller.getState();
        return state !== undefined && state.path !== null ? state.content : null;
      },
      editBuffer: editNote,
      flush: flushCurrent,
      ack: (id, outcome) => {
        bridge.ackCapture({ id, outcome }).catch(() => {});
      },
      onApplied: () => toast.success("Captured to today's note"),
    });
    const unsubscribe = bridge.onCaptureApply(applier.apply);
    return () => {
      applier.dispose();
      unsubscribe();
    };
  }, [editNote, flushCurrent]);

  // Expose the flush + open-note path to non-React callers (the voice transcript
  // path) so a dictated turn persists the open note AND tags the agent with which
  // file "this note" means — same as the typed composer. The path getter reads
  // the live runtime, so it stays correct without re-registering per open.
  useEffect(() => {
    registerOpenNoteFlush(flushCurrent);
    registerOpenNotePath(() => runtimeRef.current?.controller.getState().path ?? null);
    // AI-path privacy read (fail-closed: indeterminate counts as private) —
    // agent-store omits the note-context hint for a private note. Reads the
    // live buffer, not the saved file, so a just-typed `private: true` is
    // honored on the very next send. The OTHER staleness direction — disk
    // flipped private by a sync pull / agent write while this buffer still
    // holds the public text — is covered host-side: agent-store re-probes
    // live disk (probeNotePrivacy) before attaching the path.
    registerOpenNotePrivacy(() => {
      const state = runtimeRef.current?.controller.getState();
      if (!state || state.path === null) return true; // no note → nothing to attach anyway
      return notePrivacy(state.content) !== "public";
    });
    return () => {
      registerOpenNoteFlush(null);
      registerOpenNotePath(null);
      registerOpenNotePrivacy(null);
    };
  }, [flushCurrent]);

  const folderName = useMemo(() => {
    const cleaned = root.replace(/[/\\]+$/, "");
    return cleaned.split(/[/\\]/).pop() ?? cleaned;
  }, [root]);

  // Alias entries for the local resolver: the host's knowledge index owns
  // alias extraction; the renderer pulls WikiTargets (path + aliases) over
  // the Bridge so chips, transclusion, and autocomplete resolve `[[alias]]`
  // exactly like backlinks do. Refreshed with every listing refresh and on
  // knowledge updates — the index lags saves ~100-300ms, so a just-added
  // alias resolves slightly late (same as the backlinks panel).
  const [wikiTargets, setWikiTargets] = useState<WikiTarget[]>([]);
  const refreshWikiTargets = useCallback(() => {
    getBridge()
      .listWikiTargets()
      .then((targets) => {
        // Keep the previous reference when the payload is value-identical —
        // every autosave's knowledge pass re-emits the full list, and a fresh
        // array would rebuild the resolver + cascade a rerender for nothing.
        // (JSON compare is fine at wiki-target list size.)
        setWikiTargets((prev) =>
          JSON.stringify(prev) === JSON.stringify(targets) ? prev : targets,
        );
        return undefined;
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshWikiTargets();
    return getBridge().onKnowledgeUpdated(() => refreshWikiTargets());
  }, [refreshWikiTargets]);

  // Wiki resolution over the live listing — same engine as the host's index,
  // so chips and the knowledge channels agree on what resolves. The listing
  // stays the path authority (aliases only fill the below-path tiers).
  const resolver = useMemo(() => {
    const aliasEntries: Array<readonly [string, string]> = [];
    for (const target of wikiTargets) {
      for (const alias of target.aliases ?? []) aliasEntries.push([alias, target.path]);
    }
    return buildResolver(
      entries.map((e) => e.path),
      aliasEntries,
    );
  }, [entries, wikiTargets]);
  const resolveWikiTarget = useCallback(
    (target: string) => resolver.resolveWiki(target),
    [resolver],
  );

  // Stable for the provider's lifetime — every dep is a stable callback.
  const actions = useMemo<VaultActions>(
    () => ({
      openFile,
      editNote,
      registerNoteSerializeFlush,
      createFile,
      createFileAt,
      renameEntry,
      deleteEntry,
      changeFolder,
      flush: flushCurrent,
      refreshVault,
      setMode: setOpenNoteMode,
      showHtmlAsText: showOpenHtmlAsText,
      showHtmlAsApp: showOpenHtmlAsApp,
    }),
    [
      openFile,
      editNote,
      registerNoteSerializeFlush,
      createFile,
      createFileAt,
      renameEntry,
      deleteEntry,
      changeFolder,
      flushCurrent,
      refreshVault,
    ],
  );

  const listing = useMemo<VaultListing>(
    () => ({ entries, folderName, resolveWikiTarget }),
    [entries, folderName, resolveWikiTarget],
  );

  const host = useMemo<EditorHost>(
    () => ({ actions, listing, ConnectionsPanel }),
    [actions, listing],
  );

  return <EditorHostProvider host={host}>{children}</EditorHostProvider>;
}
