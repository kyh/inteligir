import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import type { TextMatchOptions } from "@repo/notes/knowledge/text-matches";
import { basenamePath, dirnamePath, joinPath } from "@repo/notes/knowledge/vault-path";
import { composeItemFile } from "@repo/notes/items/item-frontmatter";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { formatItemTime } from "@repo/notes/items/item-time";
import { quoteSelection } from "@repo/domain/quote-selection";
import type { ActionPreset } from "@repo/domain/action-preset";
import type { LibraryScope } from "@repo/domain/library-scope";
import { LIBRARY_SELECTION_MAX } from "@repo/domain/view-context";
import type { LibraryViewContext, ViewContext } from "@repo/domain/view-context";
import type { ViewContextSource } from "./thread-activity";
import type { AnnotationsResponse } from "@repo/contract/local/annotations/annotations-schema";
import type { VaultMatchWire } from "@repo/contract/local/knowledge/knowledge-schema";
import type { Thread } from "@repo/contract/local/threads/threads-schema";
import type { VaultEntry } from "@repo/contract/local/vault/vault-schema";
import type { itemsRefreshRequestSchema } from "@repo/contract/local/items/items-schema";
import type { z } from "zod";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
import { plural } from "@repo/ui/lib/plural";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { client, failed } from "./api";
import { ActionComposer } from "./actions/action-composer";
import type { ComposerSelection } from "./actions/action-composer";
import { ActionsPanel } from "./actions/actions-panel";
import type { PanelTab } from "./actions/actions-panel";
import type { AnnotationFocus } from "./actions/annotations-tab";
import type { InfoActions, PanelSubject } from "./actions/info-tab";
import {
  holdAnnotations,
  rereadAnnotations,
  useNoteAnnotations,
  useNoteAnnotationMeta,
} from "./actions/annotation-hooks";
import { useThreads } from "./actions/thread-hooks";
import { useTurnFinishToast } from "./actions/turn-finish-toast";
import { useSyncConflictNotices } from "./sync-conflict-notices";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { bindingFor, useGlobalShortcuts } from "./global-shortcuts";
import { hideFindBar, jumpToFindMatch, openFindBar } from "@repo/editor/find-bar";
import { getLiveEditor, whenLiveEditor } from "@repo/editor/live-editor";
import { collectHeadings, goToHeading } from "@repo/editor/toc";
import type { HeadingItem } from "@repo/editor/toc";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { openDocPath } from "@repo/editor/note/open-doc";
import { createOpenNoteStore, historyStep } from "@repo/editor/note/open-note-store";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";
import { exportNoteAsPdf } from "./note/export-pdf";
import type { EditorHostActions, VaultActions } from "@repo/editor/host-io";
import { ItemView } from "./item/item-view";
import { runBulk } from "./library/bulk-actions";
import { captureDir, savePayload } from "./library/capture/save-items";
import { filesPayload } from "./library/capture/capture-payload";
import type { CapturePayload } from "./library/capture/capture-payload";
import { useWindowCapture } from "./library/capture/window-capture";
import { NameDialog, TagDialog } from "./library/item-dialogs";
import type { NameDialogRequest, TagDialogRequest } from "./library/item-dialogs";
import type { LibraryItemActions } from "./library/item-menu";
import {
  cachedItemIds,
  filterRequest,
  useItemSourceUrl,
  useLibraryScopes,
  useListingTotal,
} from "./library/library-items";
import type { LibraryFilter } from "./library/library-items";
import { useTidyEntry } from "./library/tidy-library";
import { createLibrarySelection, selectionCount } from "./library/library-selection";
import type { LibrarySelection } from "./library/library-selection";
import { createSelectionFollow, movedItemOf } from "./library/selection-follow";
import { LibraryView, selectionPaths } from "./library/library-view";
import { RaindropImport } from "./library/raindrop-import";
import type { RaindropImportHandle } from "./library/raindrop-import";
import { RenameTagDialog } from "./library/rename-tag-dialog";
import { subscribeOpenRequests } from "./open-requests";
import { readNoteViewContext } from "./note/note-view-context";
import { retagItems } from "./note/item-frontmatter";
import { setNotePinned } from "./note/pin-note";
import type { PinNoteApi } from "./note/pin-note";
import { VaultProvider } from "./note/vault-provider";
import { CommandPalette } from "./palette/command-palette";
import type {
  PaletteActions,
  PaletteEntry,
  PaletteRequest,
  PaletteSource,
} from "./palette/command-palette";
import { Sidebar } from "@repo/ui/components/sidebar";
import { SidebarInset, SidebarProvider } from "@repo/ui/components/sidebar-core";
import type { SidebarActions } from "@repo/ui/components/sidebar-core";
import type { SettingsSection } from "./settings/settings-page";
import { SidebarRailContent } from "./sidebar/sidebar";
import { planMove, scopeAfterMove, useTreeOps } from "./sidebar/tree-ops";
import type { TreeOps } from "./sidebar/tree-ops";
import { useNavigate } from "@tanstack/react-router";
import {
  canSyncNow,
  useSyncNow,
  usePinnedPaths,
  useVaultStatus,
  useVaultTree,
} from "./vault-hooks";
import { PREFS, readPref, usePref, writePref } from "./prefs";
import { hasInsetTitleBar } from "./title-bar";
import { useWorkspace } from "./workspace-context";

export interface WorkspaceProps {
  // read once, at boot: after that the note store owns the open item and `onOpenItem` mirrors it
  bootItem: string | null;
  onOpenItem: (path: string | null) => void;
  // another surface draws over the workspace: it goes inert and its window-level chords stand
  // down. Its root isolates the z-indices inside, so a later sibling covers every one of them.
  covered: boolean;
}

const EMPTY_ENTRIES: readonly VaultEntry[] = [];
const EMPTY_THREADS: readonly Thread[] = [];

// a bulk delete this large asks first; any fewer go at once, each recoverable from Deleted
const DELETE_ASKS_OVER = 50;

// the most selected paths a files-changed frame looks up at once to prune the selection
const PRUNE_LOOKUP_MAX = 200;

// what the panel is asked to show; an annotations reveal with no focus keeps the last one
type PanelReveal =
  | { tab: "actions"; threadId: string }
  | { tab: "annotations"; focus?: readonly string[] }
  | { tab: "history" };

// a note that never mounts (a refused open) must not leave a jump waiting forever
const LIVE_EDITOR_WAIT_MS = 5000;

const jumpWhenLive = async (
  path: string,
  needle: string,
  ordinal: number,
  options: TextMatchOptions,
): Promise<void> => {
  const editor = await whenLiveEditor(path, LIVE_EDITOR_WAIT_MS);
  if (editor !== null) {
    jumpToFindMatch(editor, needle, ordinal, options);
  }
};

// for verbs only: a render reads the editor through useLiveEditor, which re-renders as it mounts
const openLiveEditor = (noteStore: OpenNoteStore) => {
  const { openPath } = noteStore.state();
  return openPath === null ? null : getLiveEditor(openPath);
};

const pinAndReport = async (api: PinNoteApi, path: string, pinned: boolean): Promise<void> => {
  const outcome = await setNotePinned(api, path, pinned);
  if (outcome.kind === "refused") {
    toast.error(outcome.message);
  }
};

const setPinned = (path: string, pinned: boolean): void => {
  void pinAndReport(client, path, pinned);
};

const isNonEmpty = (paths: readonly string[]): paths is readonly [string, ...string[]] =>
  paths.length > 0;

// a stored folder scope the library no longer lists reads as every item
const listedScope = (
  scope: LibraryScope,
  folders: readonly { path: string }[] | undefined,
): LibraryScope =>
  scope.kind === "folder" &&
  folders !== undefined &&
  !folders.some((folder) => folder.path === scope.path)
    ? { kind: "all" }
    : scope;

type ItemsRefreshInput = z.input<typeof itemsRefreshRequestSchema>;

// "Keep a copy of the page" and "Refresh from the page", the same calls wherever they appear
const refreshItem = async (
  path: string,
  change: { keepCopy?: true; replace?: true },
): Promise<void> => {
  if (change.replace === true) {
    const confirmed = await confirm({
      body: "Its text is read again from the page, and what was saved is replaced.",
      confirmLabel: "Replace",
      destructive: true,
      title: "Replace the saved text with the page as it is now?",
    });
    if (!confirmed) {
      return;
    }
  }
  const request: ItemsRefreshInput = { path, wait: false };
  if (change.keepCopy === true) {
    request.keepCopy = true;
    request.text = "keep";
  }
  if (change.replace === true) {
    request.text = "replace";
  }
  try {
    await client.items.refresh(request);
    toast.success(
      change.keepCopy === true ? "Keeping a copy of the page" : "Reading the page again",
    );
  } catch (error) {
    failed(error, "The page couldn't be read again.");
  }
};

// what the panel is about: the open item, else one selected item, else the selection, else the scope
const panelSubjectOf = (
  openPath: string | null,
  selected: LibrarySelection,
  scope: LibraryScope,
): PanelSubject => {
  if (openPath !== null) {
    return { kind: "item", path: openPath };
  }
  const [only] = selected.selected;
  if (!selected.all && selected.selected.size === 1 && only !== undefined) {
    return { kind: "item", path: only };
  }
  if (selected.all || selected.selected.size > 1) {
    return { all: selected.all, kind: "selection", paths: [...selected.selected], scope };
  }
  return { kind: "scope", scope };
};

// what a message from the library is about, drawn as the composer's one chip
const composerSelectionOf = (
  filter: LibraryFilter | null,
  selected: LibrarySelection,
  listingTotal: number,
): ComposerSelection | null => {
  if (filter === null) {
    return null;
  }
  const subject: ComposerSelection = {
    all: selected.all,
    paths: [...selected.selected].slice(0, LIBRARY_SELECTION_MAX),
    scope: filter.scope,
    total: selectionCount(selected, listingTotal),
  };
  if (filter.kind !== null) {
    subject.kinds = [filter.kind];
  }
  if (filter.q !== null) {
    subject.q = filter.q;
  }
  return subject;
};

// a saved page's own verbs in ⌘P: the same calls Info and the card's menu make
const paletteSourceOf = (path: string, url: string | null): PaletteSource | null =>
  url === null
    ? null
    : {
        keepCopy: () => {
          void refreshItem(path, { keepCopy: true });
        },
        openOriginal: () => {
          window.open(url, "_blank", "noopener");
        },
        refresh: () => {
          void refreshItem(path, {});
        },
      };

// a viewer's original is no doc: ⌘K and the panel's doc tabs bind to docs alone
const docOf = (path: string | null): string | null =>
  path !== null && isDocPath(path) ? path : null;

// a free name for a new note in `folder`, against the listing the rail holds
const untitledIn = (folder: string, taken: readonly string[]): string => {
  let name = "Untitled";
  for (let n = 2; taken.includes(joinPath(folder, `${name}.md`)); n += 1) {
    name = `Untitled ${String(n)}`;
  }
  return joinPath(folder, `${name}.md`);
};

export const Workspace = ({ bootItem, onOpenItem, covered }: WorkspaceProps) => {
  const queryClient = useQueryClient();
  const { vaultChanges } = useWorkspace();
  const treeQuery = useVaultTree();
  const statusQuery = useVaultStatus();
  const scopesQuery = useLibraryScopes();

  // Each open is a fresh request, keyed by its nonce so the palette mounts clean. A close keeps
  // the last request mounted with `open` off, because unmounting the dialog cuts its exit tween;
  // the next open replaces it.
  const [palette, setPalette] = useState<{ request: PaletteRequest; open: boolean } | null>(null);
  const openPalette = (entry: PaletteEntry): void => {
    setPalette((current) => ({
      open: true,
      request: { ...entry, nonce: (current?.request.nonce ?? 0) + 1 },
    }));
  };
  const closePalette = (): void => {
    setPalette((current) => (current === null ? null : { ...current, open: false }));
  };
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [shortcutModifier] = useState(platformShortcutModifier);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [insetTitleBar] = useState(hasInsetTitleBar);

  // The action surface's state lives beside the item, never above it, so no
  // agent interaction can remount the editor.
  const threadsQuery = useThreads();
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSeed, setComposerSeed] = useState<string | null>(null);
  // the named action ⌘K was opened on, if any; an ordinary open clears it
  const [composerPreset, setComposerPreset] = useState<ActionPreset | null>(null);
  const [zen, setZen] = useState(false);
  // Narrow selectors only: the store settles on every keystroke.
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [noteStore] = useState(createOpenNoteStore);
  const openPath = useStore(noteStore.store, (state) => state.openPath);
  // Trails `openPath` across a switch; the annotation tint keys on it.
  const loadedPath = useStore(noteStore.store, (state) => openDocPath(state.openDoc));
  const back = useStore(noteStore.store, (state) => historyStep(state, "back")?.to);
  const forward = useStore(noteStore.store, (state) => historyStep(state, "forward")?.to);
  const openDoc = docOf(openPath);

  // CLAUDE.md § THE GRID'S SELECTION IS A STORE: made once here, with the grid's scroll, so the
  // library unmounting under an open item finds both as it left them
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [selection] = useState(createLibrarySelection);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [scrollMemory] = useState(() => createStore<number>()(() => 0));
  const selected = useStore(selection.store);
  const [storedScope, storeScope] = usePref(PREFS.libraryScope);
  const scope = listedScope(storedScope, scopesQuery.data?.folders);
  const [kind, setKind] = useState<ItemKind | null>(null);
  const [q, setQ] = useState<string | null>(null);
  const [sort, setSort] = usePref(PREFS.librarySort);
  const libraryFilter: LibraryFilter | null =
    scope.kind === "deleted" ? null : { kind, q, scope, sort };
  // the grid's own first window, shared through the cache: how many a ⌘A stands for
  const listingTotal = useListingTotal(libraryFilter, openPath === null);

  // a new scope is a new listing: the selection, the chip, the search and the scroll go with it
  const setScope = useCallback(
    (next: LibraryScope): void => {
      storeScope(next);
      setKind(null);
      setQ(null);
      selection.apply({ kind: "clear" });
      scrollMemory.setState(0, true);
    },
    [storeScope, selection, scrollMemory, setKind, setQ],
  );

  // walked as the headings page opens, never in render: nothing re-renders the workspace when the
  // document changes.
  const listOpenHeadings = (): readonly HeadingItem[] => {
    const editor = openLiveEditor(noteStore);
    return editor === null ? [] : collectHeadings(editor);
  };

  const [panelThreadId, setPanelThreadId] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = usePref(PREFS.panelOpen);
  const [panelTab, setPanelTab] = useState<PanelTab>("info");
  // Here, not in the panel: the top bar's badge counts while the panel is collapsed.
  const annotationsQuery = useNoteAnnotations(openDoc);
  const annotationCount = annotationsQuery.data?.total ?? 0;

  useNoteAnnotationMeta(loadedPath);

  const [railOpen, setRailOpen] = useState(true);
  // a provider's own toggle and the table's key both land here: showing either side leaves zen
  const showRail = useCallback((show: boolean): void => {
    if (show) {
      setZen(false);
    }
    setRailOpen(show);
  }, []);
  const showPanel = useCallback(
    (show: boolean): void => {
      if (show) {
        setZen(false);
      }
      setPanelOpen(show);
    },
    [setPanelOpen],
  );
  // the toggles the providers own, since below the mobile breakpoint a side is a sheet whose open
  // state only its provider holds
  const railActionsRef = useRef<SidebarActions | null>(null);
  const panelActionsRef = useRef<SidebarActions | null>(null);
  // held by hand: the top bars take it inside an object, where the compiler cannot see it is only
  // ever a click's
  const toggleRail = useCallback((): void => {
    railActionsRef.current?.toggle();
  }, []);

  const [annotationFocus, setAnnotationFocus] = useState<AnnotationFocus | null>(null);
  // One verb for every entry that shows something in the panel: it starts closed, so an entry
  // that only picks its tab or thread shows nothing.
  const revealPanel = useCallback(
    (target: PanelReveal): void => {
      showPanel(true);
      setPanelTab(target.tab);
      if (target.tab === "actions") {
        setPanelThreadId(target.threadId);
      } else if (target.tab === "annotations" && target.focus !== undefined) {
        const ids = target.focus;
        setAnnotationFocus((current) => ({ ids, nonce: (current?.nonce ?? 0) + 1 }));
      }
    },
    [showPanel, setPanelTab, setPanelThreadId],
  );

  const openThread = (threadId: string): void => {
    revealPanel({ tab: "actions", threadId });
  };

  // CLAUDE.md § THE AGENT SURFACE: with no item open the message is about the library, its scope
  // and its selection, ⌘A's names read from the listing; with one open, about that item, a viewer
  // included, since a viewer opens its doc as any item does
  const readLibraryContext = async (): Promise<LibraryViewContext | null> => {
    if (libraryFilter === null) {
      return null;
    }
    const { all, selected: chosen } = selection.store.getState();
    let paths: readonly string[] = [...chosen].slice(0, LIBRARY_SELECTION_MAX);
    let total = chosen.size;
    if (all) {
      const listed = await client.knowledge.itemPaths({
        ...filterRequest(libraryFilter),
        limit: LIBRARY_SELECTION_MAX,
        offset: 0,
      });
      ({ paths, total } = listed);
    }
    const context: LibraryViewContext = {
      paths: [...paths],
      scope: libraryFilter.scope,
      selected: total,
      surface: "library",
    };
    if (libraryFilter.kind !== null) {
      context.kinds = [libraryFilter.kind];
    }
    if (libraryFilter.q !== null) {
      context.q = libraryFilter.q;
    }
    return context;
  };

  const readViewContext: ViewContextSource = async (): Promise<ViewContext | null> => {
    const { editor, openPath: shown } = noteStore.state();
    if (shown === null) {
      return await readLibraryContext();
    }
    if (editor.kind === "closed") {
      return null;
    }
    const { path } = editor;
    return await readNoteViewContext(path, {
      flush: async () => {
        await flushOpenNote();
      },
      read: () => {
        const current = noteStore.state().editor;
        return current.kind === "open" && current.path === path
          ? { content: current.content }
          : null;
      },
    });
  };

  const actionsRef = useRef<VaultActions | null>(null);
  const noteColumnRef = useRef<HTMLElement | null>(null);
  // Ordinary opens, Back and Forward included: the store's stacks recognize a back/forward move
  // by value, and `null` is the library.
  // held by hand, as showHistory is: VaultProvider re-points its merge-conflict toast in an effect
  const openItem = useCallback((path: string | null): void => {
    if (path === null) {
      actionsRef.current?.closeFile();
      return;
    }
    actionsRef.current?.openFile(path);
  }, []);

  // CLAUDE.md § THE NOTE STORE OWNS THE OPEN ITEM: nothing open is the library, so going back to
  // it is closing the item, and naming a scope narrows it on the way
  const goToLibrary = useCallback(
    (next?: LibraryScope): void => {
      if (next !== undefined) {
        setScope(next);
      }
      actionsRef.current?.closeFile();
    },
    [setScope],
  );

  // Back and Forward over the one history, where `null` is the library
  const stepHistory = (direction: "back" | "forward"): void => {
    const step = historyStep(noteStore.state(), direction);
    if (step !== null) {
      openItem(step.to);
    }
  };

  const showHistory = useCallback(
    (path: string): void => {
      openItem(path);
      revealPanel({ tab: "history" });
    },
    [openItem, revealPanel],
  );

  useTurnFinishToast(showHistory);
  useSyncConflictNotices(openItem);

  // a files-changed frame that took a selected item away takes it out of the selection, unless the
  // item only moved (a fill names a saved link's stub by its page's title): the selection, its
  // focus and Quick Look follow it there by its id, as the open item does
  useEffect(() => {
    const follow = createSelectionFollow({
      apply: selection.apply,
      ask: async (lastPath, id) =>
        movedItemOf(await client.knowledge.pathForNoteId({ id, lastPath })),
    });
    const unsubscribe = vaultChanges.subscribe((event) => {
      if (event.kind !== "files" || event.paths === null) {
        return;
      }
      const now = selection.store.getState();
      const held = new Set([
        ...now.selected,
        ...[now.anchor, now.focus].filter((path) => path !== null),
      ]);
      const touched = event.paths.filter((path) => held.has(path)).slice(0, PRUNE_LOOKUP_MAX);
      if (touched.length === 0) {
        return;
      }
      // read now, before the change's sweep refetches the rows that name them
      const ids = cachedItemIds(queryClient, touched);
      void (async () => {
        try {
          const { items } = await client.knowledge.itemsAt({ paths: touched });
          const still = new Set(items.map((row) => row.path));
          follow.follow(
            touched.filter((path) => !still.has(path)),
            ids,
          );
        } catch {
          // the next change looks again
        }
      })();
    });
    return () => {
      unsubscribe();
      follow.dispose();
    };
  }, [vaultChanges, selection, queryClient]);

  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [initialSidebarWidth] = useState(() => `${String(readPref(PREFS.sidebarWidth))}px`);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [initialPanelWidth] = useState(() => `${String(readPref(PREFS.panelWidth))}px`);
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [tagRequest, setTagRequest] = useState<TagDialogRequest | null>(null);
  const [nameRequest, setNameRequest] = useState<NameDialogRequest | null>(null);
  const addFilesRef = useRef<HTMLInputElement | null>(null);
  const raindropRef = useRef<RaindropImportHandle | null>(null);
  const importRaindrop = (): void => {
    raindropRef.current?.choose();
  };

  // an item a surface over the workspace (Settings) asked to open, opened under it
  useEffect(() => subscribeOpenRequests(openItem), [openItem]);

  // a note the page makes says when it came in, as every item the app makes does
  const createNote = async (path: string, tags: readonly string[] = []): Promise<void> => {
    const made = await actionsRef.current?.createFileAt(
      path,
      composeItemFile({ saved: formatItemTime(Date.now()), tags }, ""),
    );
    if (made !== null && made !== undefined) {
      openItem(made);
    }
  };

  const newNoteIn = (folder: string, tags: readonly string[] = []): void => {
    const taken = (treeQuery.data?.entries ?? []).map((entry) => entry.path);
    void createNote(untitledIn(folder, taken), tags);
  };

  // the live editor is keyed by path, so an item mid-switch answers no editor and the bar stays shut
  const findInNote = (): void => {
    const editor = openLiveEditor(noteStore);
    if (editor !== null) {
      openFindBar(editor);
    }
  };

  // the item opens first; the find bar takes the match once its editor is live
  const openMatch = (match: VaultMatchWire, needle: string, options: TextMatchOptions): void => {
    openItem(match.path);
    void jumpWhenLive(match.path, needle, match.ordinal, options);
  };

  const { syncNow, inFlight: syncInFlight } = useSyncNow();

  const pinnedPaths = usePinnedPaths();
  // the open item's web address, when it came from one, for the palette's page verbs
  const sourceUrl = useItemSourceUrl(openDoc);
  const openPinned = openDoc !== null && pinnedPaths.has(openDoc);

  const sessionTreeOps = useTreeOps({
    actions: actionsRef,
    createNote,
    setPinned,
  });
  // the folder the grid shows follows a rename or a move of it, or of a folder above it, from any
  // surface (the rail's Rename, a drag, Move to…, Info), so the grid never falls back to All items
  // while the remembered scope names a folder that left
  const followFolder = (from: string, to: string): void => {
    const followed = scopeAfterMove(readPref(PREFS.libraryScope), from, to);
    if (followed !== null) {
      storeScope(followed);
    }
  };
  const treeOps: TreeOps = {
    ...sessionTreeOps,
    moveEntry: async (fromPath, toDir) => {
      const plan = planMove(fromPath, toDir);
      const moved = await sessionTreeOps.moveEntry(fromPath, toDir);
      if (moved && plan.ok) {
        followFolder(fromPath, plan.to);
      }
      return moved;
    },
    renameEntry: async (fromPath, toPath) => {
      const renamed = await sessionTreeOps.renameEntry(fromPath, toPath);
      if (renamed) {
        followFolder(fromPath, toPath);
      }
      return renamed;
    },
  };

  const saveInto = (payload: CapturePayload, folder: string): void => {
    void savePayload(payload, folder, { open: openItem });
  };

  const { catcherRef, dropInto } = useWindowCapture({
    dirFor: () => captureDir(scope),
    enabled: !covered,
    onCapture: saveInto,
  });

  const moveItems = (paths: readonly string[], toDir: string): void => {
    void runBulk({
      chunk: 1,
      done: (count) =>
        `Moved ${plural(count, "item")} to ${toDir === "" ? "the library" : basenamePath(toDir)}`,
      items: paths,
      run: async ([path]) => (path !== undefined && (await treeOps.moveEntry(path, toDir)) ? 1 : 0),
      verb: "Moving",
    });
  };

  const removeItems = (paths: readonly string[]): void => {
    void (async () => {
      if (paths.length > DELETE_ASKS_OVER) {
        const confirmed = await confirm({
          body: "Every one stays recoverable from Deleted.",
          confirmLabel: "Delete",
          destructive: true,
          title: `Delete ${plural(paths.length, "item")}?`,
        });
        if (!confirmed) {
          return;
        }
      }
      await runBulk({
        chunk: 1,
        done: (count) => `Deleted ${plural(count, "item")}`,
        items: paths,
        run: async ([path]) =>
          path !== undefined && (await actionsRef.current?.deleteEntry(path)) === true ? 1 : 0,
        verb: "Deleting",
      });
      selection.apply({ gone: new Set(paths), kind: "prune" });
    })();
  };

  const openComposer = (preset: ActionPreset | null): void => {
    setComposerSeed(null);
    setComposerPreset(preset);
    setComposerOpen(true);
  };

  const tidy = useTidyEntry({ actions: actionsRef, openComposer, openItem });

  const itemActions: LibraryItemActions = {
    askAgent: () => {
      openComposer(null);
    },
    keepCopy: (path) => {
      void refreshItem(path, { keepCopy: true });
    },
    move: (paths) => {
      if (isNonEmpty(paths)) {
        openPalette({ page: "move-to-folder", subjects: paths });
      }
    },
    open: (path) => {
      openItem(path);
    },
    // the grid draws its own Quick Look; from anywhere else the item opens
    quickLook: (path) => {
      openItem(path);
    },
    refresh: (path, replace) => {
      void refreshItem(path, replace ? { replace: true } : {});
    },
    remove: removeItems,
    rename: (path) => {
      const name = basenamePath(path);
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const extension = dot > 0 ? name.slice(dot) : "";
      setNameRequest({
        confirm: "Rename",
        initial: stem,
        label: "Name",
        onSubmit: (next) => {
          void treeOps.renameEntry(path, joinPath(dirnamePath(path), `${next}${extension}`));
        },
        title: `Rename ${stem}`,
      });
    },
    reveal: treeOps.revealEntry ?? null,
    setPinned,
    tag: (paths) => {
      setTagRequest({ paths });
    },
  };

  const infoActions: InfoActions = {
    ...itemActions,
    onRenameFolder: (path) => {
      setNameRequest({
        confirm: "Rename",
        initial: basenamePath(path),
        label: "Folder name",
        onSubmit: (next) => {
          void (async () => {
            const to = joinPath(dirnamePath(path), next);
            await treeOps.renameEntry(path, to);
          })();
        },
        title: `Rename ${basenamePath(path)}`,
      });
    },
    onRenameTag: setRenamingTag,
    withSelection: (run) => {
      void (async () => {
        const paths = await selectionPaths(selection, libraryFilter);
        if (paths.length > 0) {
          run(paths);
        }
      })();
    },
  };

  const subject = panelSubjectOf(openPath, selected, scope);

  const composerSelection =
    openPath === null ? composerSelectionOf(libraryFilter, selected, listingTotal) : null;

  const navigate = useNavigate();
  // Settings covers a workspace that stays mounted, so no unmount settles a title mid-rename or
  // an edit inside the autosave debounce: the blur and the flush stand in for it. The palette and
  // the find bar are portaled, so the cover would hide neither: both close here.
  const onOpenSettings = (section?: SettingsSection): void => {
    closePalette();
    const editor = openLiveEditor(noteStore);
    if (editor !== null) {
      hideFindBar(editor);
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    void flushOpenNote();
    // the router scrolls a hash's anchor into view once the page has rendered
    if (section === undefined) {
      void navigate({ search: true, to: "/settings" });
    } else {
      void navigate({ hash: section, search: true, to: "/settings" });
    }
  };

  // Held by hand, with showRail, revealPanel and showPanel under it: VaultProvider re-installs the
  // editor host whenever this changes, which a compiler bailout must not make every render.
  const hostActions = useMemo<EditorHostActions>(
    () => ({
      agent: {
        askAboutSelection: (selectionText) => {
          setComposerSeed(quoteSelection(selectionText));
          setComposerPreset(null);
          setComposerOpen(true);
        },
        // a `#tag` chip shows the library scoped to the tag
        showTag: (tag) => {
          showRail(true);
          goToLibrary({ kind: "tag", tag });
        },
      },
      annotations: {
        // flushed before adding: the route derives `anchored` from disk
        create: async (id, quote) => {
          const { openPath: path } = noteStore.state();
          if (path === null) {
            return false;
          }
          await flushOpenNote();
          let listing: AnnotationsResponse;
          try {
            listing = await client.annotations.add({ id, path, quote });
          } catch {
            rereadAnnotations(queryClient, path);
            return false;
          }
          holdAnnotations(queryClient, path, listing);
          return true;
        },
        edit: async (id, text) => {
          const { openPath: path } = noteStore.state();
          if (path === null) {
            return false;
          }
          let listing: AnnotationsResponse;
          try {
            listing = await client.annotations.edit({ id, path, text });
          } catch (error) {
            failed(error, "The note on that highlight was refused.");
            rereadAnnotations(queryClient, path);
            return false;
          }
          holdAnnotations(queryClient, path, listing);
          return true;
        },
        open: (ids) => {
          revealPanel({ focus: ids, tab: "annotations" });
        },
      },
    }),
    [goToLibrary, showRail, noteStore, queryClient, revealPanel],
  );

  useGlobalShortcuts({ enabled: !covered, modifier: shortcutModifier }, (action) => {
    switch (action) {
      case "open-action-composer": {
        setComposerSeed(null);
        setComposerPreset(null);
        setComposerOpen((current) => !current);
        break;
      }
      case "open-palette": {
        if (palette?.open === true) {
          closePalette();
        } else {
          openPalette({ page: "root" });
        }
        break;
      }
      case "find-in-note": {
        findInNote();
        break;
      }
      case "open-headings": {
        openPalette({ outline: listOpenHeadings(), page: "headings" });
        break;
      }
      case "open-settings": {
        onOpenSettings();
        break;
      }
      case "toggle-zen": {
        setZen((current) => !current);
        break;
      }
      case "toggle-rail": {
        railActionsRef.current?.toggle();
        break;
      }
      case "toggle-panel": {
        panelActionsRef.current?.toggle();
        break;
      }
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  });

  const canSync = canSyncNow(statusQuery.data) && !syncInFlight;

  const treeEntries = treeQuery.data?.entries ?? EMPTY_ENTRIES;

  const paletteActions: PaletteActions = {
    addFiles: () => {
      addFilesRef.current?.click();
    },
    goToHeading: (heading) => {
      const editor = openLiveEditor(noteStore);
      if (editor !== null) {
        goToHeading(editor, heading);
      }
    },
    moveItems,
    newNote: newNoteIn,
    note:
      openDoc === null
        ? null
        : {
            exportPdf: () => {
              void exportNoteAsPdf(docStem(openDoc));
            },
            findInNote,
            listHeadings: listOpenHeadings,
            path: openDoc,
            pinned: openPinned,
            source: paletteSourceOf(openDoc, sourceUrl),
            togglePin: () => {
              setPinned(openDoc, !openPinned);
            },
          },
    openDeletedNotes: () => {
      goToLibrary({ kind: "deleted" });
    },
    openMatch,
    openNote: openItem,
    openSettings: () => {
      onOpenSettings();
    },
    openThread,
    importRaindrop,
    saveLink: (url) => {
      saveInto({ files: [], refused: [], urls: [{ title: null, url }] }, captureDir(scope));
    },
    // ⌘P stays the one search field: the grid takes what it holds as its filter
    // the palette's rows were the whole library's, so its results are too: never a folder's
    // share of them, nor Deleted, which has no grid to show them in. The scope clears the search,
    // the kind, the selection and the scroll, so the search is set after it
    showResults: (text) => {
      goToLibrary({ kind: "all" });
      setQ(text);
    },
    startTidy: tidy.startTidy,
    syncNow,
  };

  const threads = threadsQuery.data ?? EMPTY_THREADS;

  const lead = {
    canBack: back !== undefined,
    canForward: forward !== undefined,
    onBack: () => {
      stepHistory("back");
    },
    onForward: () => {
      stepHistory("forward");
    },
    onToggleRail: toggleRail,
    railOpen: railOpen && !zen,
  };

  return (
    <VaultProvider
      initialPath={bootItem}
      onOpenPath={onOpenItem}
      onShowHistory={showHistory}
      actionsRef={actionsRef}
      hostActions={hostActions}
      store={noteStore}
    >
      <div inert={covered} className="isolate flex h-dvh flex-col bg-surface text-ink print:h-auto">
        <SidebarProvider
          className="min-h-0 flex-1 overflow-hidden print:h-auto print:overflow-visible"
          open={railOpen && !zen}
          onOpenChange={showRail}
          shortcut={bindingFor("toggle-rail", shortcutModifier)}
          onWidthCommitted={(px) => {
            writePref(PREFS.sidebarWidth, px);
          }}
          actionsRef={railActionsRef}
          peek
          width={initialSidebarWidth}
        >
          <Sidebar variant="floating" className="h-full print:hidden">
            <SidebarRailContent
              scope={scope}
              itemOpen={openPath !== null}
              onScope={goToLibrary}
              ops={treeOps}
              onMoveRequest={(paths) => {
                openPalette({ page: "move-to-folder", subjects: paths });
              }}
              onNewNoteIn={newNoteIn}
              onSaveInto={saveInto}
              onTidy={() => {
                tidy.startTidy();
              }}
              onRenameTag={setRenamingTag}
              onOpenSearch={() => {
                openPalette({ page: "root" });
              }}
              searchShortcut={bindingFor("open-palette", shortcutModifier)}
              onSyncNow={syncNow}
              onOpenSettings={onOpenSettings}
            />
          </Sidebar>
          <SidebarInset className="relative bg-surface">
            <SidebarProvider
              className="min-h-0 h-full flex-1"
              open={panelOpen && !zen}
              onOpenChange={showPanel}
              shortcut={bindingFor("toggle-panel", shortcutModifier)}
              onWidthCommitted={(px) => {
                writePref(PREFS.panelWidth, px);
              }}
              actionsRef={panelActionsRef}
              width={initialPanelWidth}
            >
              <SidebarInset ref={noteColumnRef} className="relative bg-surface">
                {openPath === null ? (
                  <LibraryView
                    scope={scope}
                    kind={kind}
                    onKindChange={(next) => {
                      setKind(next);
                      selection.apply({ kind: "clear" });
                      scrollMemory.setState(0, true);
                    }}
                    q={q}
                    onClearQuery={() => {
                      setQ(null);
                    }}
                    sort={sort}
                    onSortChange={(next) => {
                      setSort(next);
                      // a new order is a new listing, opened at its top
                      scrollMemory.setState(0, true);
                    }}
                    selection={selection}
                    scrollMemory={scrollMemory}
                    lead={lead}
                    insetTitleBar={insetTitleBar}
                    add={{
                      addFiles: () => {
                        addFilesRef.current?.click();
                      },
                      newFolder: () => {
                        const parent = scope.kind === "folder" ? scope.path : "";
                        setNameRequest({
                          confirm: "Create",
                          initial: "",
                          label: "Folder name",
                          onSubmit: (name) => {
                            treeOps.createFolder(joinPath(parent, name));
                          },
                          title: "New folder",
                        });
                      },
                      importRaindrop,
                      newNote: newNoteIn,
                      saveLink: () => {
                        openPalette({ page: "save-link" });
                      },
                    }}
                    onTidy={() => {
                      tidy.startTidy();
                    }}
                    onEditFilingRules={() => {
                      tidy.editFilingRules();
                    }}
                    onRenameTag={setRenamingTag}
                    actions={itemActions}
                    onRestored={openItem}
                  />
                ) : (
                  <ItemView
                    store={noteStore}
                    lead={lead}
                    insetTitleBar={insetTitleBar}
                    zen={zen}
                    onGoToLibrary={goToLibrary}
                    onFindInNote={findInNote}
                    annotationCount={annotationCount}
                    onOpenAnnotations={() => {
                      revealPanel({ tab: "annotations" });
                    }}
                    onExportPdf={() => {
                      if (openDoc !== null) {
                        exportNoteAsPdf(docStem(openDoc));
                      }
                    }}
                    onReadHere={(path) => {
                      void refreshItem(path, {});
                    }}
                  />
                )}
                {dropInto === null ? null : (
                  <div
                    aria-live="polite"
                    className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-surface/80 text-title font-medium text-ink"
                  >
                    Drop to save to {basenamePath(dropInto)}
                  </div>
                )}
                <ActionComposer
                  open={composerOpen}
                  onOpenChange={(next) => {
                    // a press or an Escape in the layer over a covered workspace is not one at
                    // the composer, which the way back finds as it was left
                    if (next || !covered) {
                      setComposerOpen(next);
                    }
                  }}
                  seed={composerSeed}
                  preset={composerPreset}
                  docPath={openDoc}
                  selection={composerSelection}
                  readViewContext={readViewContext}
                  onLaunched={openThread}
                  container={noteColumnRef}
                />
              </SidebarInset>
              <Sidebar side="right" className="h-full print:hidden">
                <ActionsPanel
                  docPath={openDoc}
                  tab={panelTab}
                  onTabChange={setPanelTab}
                  annotationFocus={annotationFocus}
                  selectedThreadId={panelThreadId}
                  onSelectThread={setPanelThreadId}
                  onOpenDoc={openItem}
                  subject={subject}
                  selectionCount={selectionCount(selected, listingTotal)}
                  infoActions={infoActions}
                  modifier={shortcutModifier}
                />
              </Sidebar>
            </SidebarProvider>
          </SidebarInset>
          {palette === null ? null : (
            <CommandPalette
              key={palette.request.nonce}
              open={palette.open}
              request={palette.request}
              modifier={shortcutModifier}
              onOpenChange={(open) => {
                if (!open) {
                  closePalette();
                }
              }}
              entries={treeEntries}
              threads={threads}
              canSync={canSync}
              actions={paletteActions}
            />
          )}
        </SidebarProvider>
      </div>
      <textarea
        ref={catcherRef}
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none fixed -top-full left-0 size-px opacity-0"
      />
      <input
        ref={addFilesRef}
        type="file"
        multiple
        hidden
        aria-label="Add files"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length > 0) {
            saveInto(filesPayload(files), captureDir(scope));
          }
        }}
      />
      <RaindropImport handleRef={raindropRef} />
      <TagDialog
        request={tagRequest}
        onClose={() => {
          setTagRequest(null);
        }}
        onApply={(paths, change) => {
          void retagItems(paths, change);
        }}
      />
      <NameDialog
        request={nameRequest}
        onClose={() => {
          setNameRequest(null);
        }}
      />
      <RenameTagDialog
        tag={renamingTag}
        onOpenChange={(open) => {
          if (!open) {
            setRenamingTag(null);
          }
        }}
        onRenamed={(from, to) => {
          if (scope.kind === "tag" && scope.tag === from) {
            storeScope({ kind: "tag", tag: to });
          }
        }}
      />
    </VaultProvider>
  );
};
