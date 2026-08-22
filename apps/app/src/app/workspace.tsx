// The workspace frame: sidebar (file tree + sync pill) | single-document
// editor column, with the command palette (⌘K), the daily note (⌘D) and the
// settings dialog hung off it. The open note is the route's `note` search
// param — deep-linkable, back/forward works — mirrored to localStorage so a
// fresh boot reopens where the user left off.

import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import type { ViewContext } from "@repo/domain/view-context";
import type { ViewContextSource } from "./chat/chat-model";
import type { Thread } from "@repo/server-contract/threads";
import type { VaultEntry } from "@repo/server-contract/vault";
import { ConfirmDialogHost, confirm } from "@repo/ui/components/confirm-dialog";
import { Button } from "@repo/ui/components/button";
import { XIcon } from "lucide-react";
import { cn } from "@repo/ui/lib/utils";
import { Toaster, toast } from "@repo/ui/components/sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { queryKeys, refusalMessage, unwrap } from "./api";
import { setCommentActions } from "@repo/editor/comments/comment-store";
import { ActionComposer } from "./actions/action-composer";
import { ActionsPanel, type PanelTab } from "./actions/actions-panel";
import { useNoteComments } from "./actions/comment-hooks";
import { NoteTopbar } from "./note-topbar";
import { useThreads } from "./chat/thread-hooks";
import { platformShortcutModifier, useGlobalShortcuts } from "./global-shortcuts";
import { setAgentRequestActions } from "@repo/editor/agent-request";
import { EditorPane } from "@repo/editor/editor-pane";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { exportNoteAsPdf, printTitleForPath } from "./note/export-pdf";
import type { VaultActions } from "@repo/editor/host";
import { dailyNotePath, dailyNoteTemplate } from "./note/daily";
import { readNoteViewContext } from "./note/note-view-context";
import { SplitPane, VaultProvider } from "./note/vault-provider";
import type { PaneId, VaultPanesHandle } from "./note/split-view";
import { CommandPalette } from "./palette/command-palette";
import {
  NOTE_SEARCH_LIMIT,
  searchNotesByFilename,
  type NoteSearchSource,
} from "./palette/note-search";
import { SettingsDialog } from "./settings/settings-dialog";
import { TrashDialog } from "./sidebar/trash-dialog";
import { Sidebar, SidebarInset, SidebarProvider, useSidebar } from "@repo/ui/components/sidebar";
import { SidebarRailContent } from "./sidebar/sidebar";
import type { TreeOps } from "./sidebar/file-tree";
import {
  canSyncNow,
  filePathsLowercased,
  syncNowNotice,
  untitledNotePath,
  useVaultStatus,
  useVaultTree,
} from "./vault-hooks";
import {
  readSidebarWidth,
  writeSidebarWidth,
  readSplitNote,
  writeSplitNote,
  readPanelOpen,
  writePanelOpen,
} from "./prefs";
import { useWorkspace } from "./workspace-context";

export interface WorkspaceProps {
  openNote: string | null;
  onOpenNote: (path: string | null) => void;
}

const EMPTY_ENTRIES: readonly VaultEntry[] = [];
const EMPTY_THREADS: readonly Thread[] = [];

export function Workspace({ openNote, onOpenNote }: WorkspaceProps) {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const treeQuery = useVaultTree();
  const statusQuery = useVaultStatus();

  const [paletteOpen, setPaletteOpen] = useState(false);
  // What the palette's box is seeded with on the next open. ⌘K clears it; a
  // `#tag` chip click sets it to that tag's `tag:` term.
  const [paletteQuery, setPaletteQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  // Read once: the platform does not change under a running window.
  const [shortcutModifier] = useState(platformShortcutModifier);

  // The action surface's state lives HERE, beside the note — never above it,
  // so no agent interaction can remount the editor.
  const threadsQuery = useThreads();
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSeed, setComposerSeed] = useState<string | null>(null);
  // Zen (⌘\): just the document — both rails fold away, nothing unmounts.
  const [zen, setZen] = useState(false);
  // The split pane (#595): which note the second pane shows — view state,
  // never bytes. The FOCUSED pane is what the right panel, the composer and
  // every action-time read follow.
  const [splitPath, setSplitPath] = useState<string | null>(() => readSplitNote());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [focusedPane, setFocusedPane] = useState<PaneId>("primary");
  const panesRef = useRef<VaultPanesHandle | null>(null);
  const focusedPathRef = useRef<string | null>(null);
  focusedPathRef.current = focusedPath;

  // Split ratio (primary pane's share, 0.25..0.75) — session state only.
  const [splitRatio, setSplitRatio] = useState(0.5);
  const paneRowRef = useRef<HTMLDivElement | null>(null);
  const onDividerPointerDown = useCallback((down: ReactPointerEvent<HTMLDivElement>): void => {
    down.preventDefault();
    const row = paneRowRef.current;
    if (row === null) return;
    const rect = row.getBoundingClientRect();
    const onMove = (move: PointerEvent): void => {
      const ratio = (move.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(0.75, Math.max(0.25, ratio)));
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const openInSplit = useCallback((path: string): void => {
    setSplitPath(path);
    writeSplitNote(path);
  }, []);
  const closeSplit = useCallback((): void => {
    setSplitPath(null);
    writeSplitNote(null);
  }, []);
  // The split session's open-path mirror: a wiki click inside the split moves
  // it; the note vanishing (deleted, vault switch) closes it.
  const onSplitOpenPath = useCallback(
    (path: string | null): void => {
      if (path === null) {
        closeSplit();
        return;
      }
      setSplitPath(path);
      writeSplitNote(path);
    },
    [closeSplit],
  );
  const [panelThreadId, setPanelThreadId] = useState<string | null>(null);

  // The right panel: fluid sidebar state (persisted) + the lifted tab, so the
  // top bar's comment button can aim the panel.
  const [panelOpen, setPanelOpen] = useState<boolean>(() => readPanelOpen());
  const [panelTab, setPanelTab] = useState<PanelTab>("actions");
  const setPanelOpenPersisted = useCallback((open: boolean): void => {
    setPanelOpen(open);
    writePanelOpen(open);
  }, []);
  // Mounted here, not in the panel: the hook also publishes the comment-tint
  // meta, and a collapsed panel must not take the tints down with it. The
  // panel's own call shares this query.
  const commentsQuery = useNoteComments(focusedPath);
  const openCommentCount = (commentsQuery.data?.threads ?? []).filter(
    (thread) => !thread.resolved,
  ).length;

  // Back/forward over opened notes (the top bar's arrows) — session state.
  const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const historyNavRef = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  useEffect(() => {
    if (openNote === null) return;
    if (historyNavRef.current) {
      historyNavRef.current = false;
      return;
    }
    const history = historyRef.current;
    if (history.stack[history.index] === openNote) return;
    history.stack = [...history.stack.slice(0, history.index + 1), openNote];
    history.index = history.stack.length - 1;
    setHistoryVersion((version) => version + 1);
  }, [openNote]);
  void historyVersion;
  const canBack = historyRef.current.index > 0;
  const canForward = historyRef.current.index < historyRef.current.stack.length - 1;

  const openThread = useCallback((threadId: string | null): void => {
    setPanelThreadId(threadId);
  }, []);

  // The editor's comment surface: create persists the note FIRST (the route
  // derives `anchored` from disk), then writes the sidecar entry; a clicked
  // range focuses its thread in the panel's Comments tab.
  const [commentFocus, setCommentFocus] = useState<{
    ids: readonly string[];
    nonce: number;
  } | null>(null);
  useEffect(() => {
    setCommentActions({
      create: async (id, text) => {
        // The FOCUSED pane's doc — a comment created in the split must land
        // in the split's sidecar, not the primary's.
        const path = focusedPathRef.current;
        if (path === null) {
          return false;
        }
        await flushOpenNote();
        const response = await api.comments.add.$post({ json: { id, path, text } });
        if (response.ok) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.commentsRoot });
          return true;
        }
        return false;
      },
      open: (ids) => {
        setPanelOpen(true);
        setPanelTab("comments");
        setCommentFocus({ ids, nonce: Date.now() });
      },
    });
    return () => {
      setCommentActions(null);
    };
  }, [api, queryClient]);

  // What the user is looking at, pulled at submit: the open note's buffer via
  // the store the editor publishes into. Selection offsets return with the
  // composer surface (#587) — until then the context names the note whole.
  const readViewContext = useCallback<ViewContextSource>(async (): Promise<ViewContext | null> => {
    const panes = panesRef.current;
    if (panes === null) return null;
    const { editor } = panes.focusedState();
    if (editor.path === null) {
      return null;
    }
    const path = editor.path;
    return readNoteViewContext(path, {
      flush: async () => {
        await flushOpenNote();
      },
      read: () => {
        const { editor: current } = panes.focusedState();
        return { content: current.path === path ? current.content : "", from: 0, to: 0 };
      },
    });
  }, []);

  // Deliberate opens go through the vault session (flush-then-switch); the
  // session's publishOpenPath mirrors back into the route + localStorage.
  const actionsRef = useRef<VaultActions | null>(null);
  const setOpenNote = useCallback(
    (path: string | null): void => {
      if (path === null) {
        onOpenNote(null);
        return;
      }
      actionsRef.current?.openFile(path);
    },
    [onOpenNote],
  );

  // Back/forward drive the SESSION (flush-then-switch), not the route: the
  // route mirrors back from publishOpenPath like every other open.
  const historyGo = useCallback((delta: -1 | 1): void => {
    const history = historyRef.current;
    const next = history.stack[history.index + delta];
    if (next === undefined) return;
    history.index += delta;
    historyNavRef.current = true;
    actionsRef.current?.openFile(next);
    setHistoryVersion((version) => version + 1);
  }, []);

  // The fluid sidebar owns collapse and drag-resize; the workspace owns what
  // they mean here: zen forces the rail shut without losing the user's own
  // open state, and re-opening the rail is an exit from zen.
  const [railOpen, setRailOpen] = useState(true);
  const [initialSidebarWidth] = useState(() => `${String(readSidebarWidth())}px`);

  // Open-or-create through the session: an existing note is OPENED, never
  // overwritten (createFile seeds only a genuinely new file).
  const createNote = useCallback(async (path: string, content = ""): Promise<void> => {
    await actionsRef.current?.createFile(path, content);
  }, []);

  const newUntitledNote = useCallback(
    (parentDir: string): void => {
      const existing = filePathsLowercased(treeQuery.data);
      void createNote(untitledNotePath(parentDir, existing));
    },
    [treeQuery.data, createNote],
  );

  const openDailyNote = useCallback((): void => {
    const now = new Date();
    // Unconditionally create-exclusive: an existing daily opens, a missing
    // one is minted with the template — no tree-staleness race.
    void createNote(dailyNotePath(now), dailyNoteTemplate(now));
  }, [createNote]);

  const syncNow = useCallback((): void => {
    void (async () => {
      try {
        const status = await unwrap(await api.vault.sync.$post());
        queryClient.setQueryData(queryKeys.vaultStatus, status);
        const notice = syncNowNotice(status);
        if (notice !== null) {
          toast[notice.tone](notice.message);
        }
      } catch {
        toast.error("Sync failed.");
      }
    })();
  }, [api, queryClient]);

  const treeOps = useMemo<TreeOps>(
    () => ({
      createNote: (path) => {
        void createNote(path);
      },
      createFolder: (path) => {
        void (async () => {
          try {
            await unwrap(await api.vault.mkdir.$post({ json: { path } }));
          } catch (error) {
            toast.error(refusalMessage(error, `Could not create ${path}.`));
          }
        })();
      },
      renameEntry: (fromPath, toPath) => {
        // The session flushes first, carries the open note, and toasts its own
        // refusals. A rename of the open note's ANCESTOR folder still goes
        // through the api (the session tracks files, not folders).
        void (async () => {
          const moved = await actionsRef.current?.renameEntry(fromPath, toPath);
          if (
            moved === true &&
            openNote !== null &&
            openNote !== fromPath &&
            openNote.startsWith(`${fromPath}/`)
          ) {
            setOpenNote(`${toPath}/${openNote.slice(fromPath.length + 1)}`);
          }
        })();
      },
      removeEntry: (path, kind) => {
        void (async () => {
          const confirmed = await confirm({
            title: kind === "dir" ? `Delete the folder ${path}?` : `Delete ${path}?`,
            body:
              kind === "dir"
                ? "Everything inside it is deleted with it."
                : "It moves to Trash and is kept for 30 days.",
            confirmLabel: "Delete",
            destructive: true,
          });
          if (!confirmed) {
            return;
          }
          await actionsRef.current?.deleteEntry(path);
          if (openNote !== null && openNote !== path && openNote.startsWith(`${path}/`)) {
            // A folder delete swallowing the open note: the session only
            // tracks the file itself; drop the stale selection.
            onOpenNote(null);
          }
        })();
      },
    }),
    [api, createNote, openNote, setOpenNote, onOpenNote],
  );

  const onOpenSettings = useCallback((): void => {
    setSettingsOpen(true);
  }, []);

  // The selection toolbar's "Ask agent": the selection arrives quoted, the
  // composer opens over the same note. Registered for the workspace's life.
  useEffect(() => {
    setAgentRequestActions({
      askAboutSelection: (selectionText) => {
        const quoted = selectionText
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        setComposerSeed(`${quoted}\n\n`);
        setComposerOpen(true);
      },
    });
    return () => {
      setAgentRequestActions(null);
    };
  }, []);

  useGlobalShortcuts(shortcutModifier, (action) => {
    switch (action) {
      case "open-action-composer":
        setComposerSeed(null);
        setComposerOpen((current) => !current);
        break;
      case "open-palette":
        setPaletteQuery("");
        setPaletteOpen((current) => !current);
        break;
      case "open-daily-note":
        openDailyNote();
        break;
      case "toggle-zen":
        setZen((current) => !current);
        break;
    }
  });

  const canSync = canSyncNow(statusQuery.data);

  // The palette's search source: the knowledge index's full-text + tag
  // search (`tag:<name>` terms parse engine-side), with the filename tiers as
  // the zero-query view and the fallback when the index answers nothing (a
  // filename-shaped query FTS misses) or errors.
  const treeEntries = treeQuery.data?.entries ?? EMPTY_ENTRIES;
  const sortedFilePaths = useMemo(
    () =>
      treeEntries
        // Notes only: the tree also holds comment sidecars and assets, and the
        // palette's fallback must answer the same question the index does.
        .filter((entry) => entry.kind === "file" && entry.path.endsWith(".md"))
        .map((entry) => entry.path)
        .toSorted(),
    [treeEntries],
  );
  const searchSource = useCallback<NoteSearchSource>(
    async (query, signal) => {
      // A `tag:` term is a question only the index can answer, so it suppresses
      // the filename fallback: fuzzy-matching the literal string "tag:foo"
      // against paths answers a different question with a straight face.
      const tagFiltered = parseSearchQuery(query).tag !== "";
      const byFilename = () => (tagFiltered ? [] : searchNotesByFilename(query, sortedFilePaths));
      if (query.trim() === "") {
        return byFilename();
      }
      try {
        const response = await unwrap(
          await api.knowledge.search.$get(
            { query: { q: query, limit: NOTE_SEARCH_LIMIT } },
            { init: { signal } },
          ),
        );
        if (response.results.length === 0) {
          return byFilename();
        }
        return response.results.map((result) => ({
          path: result.path,
          title: result.title,
          snippet: result.snippet,
        }));
      } catch {
        return byFilename();
      }
    },
    [api, sortedFilePaths],
  );

  const paletteActions = useMemo(
    () => ({
      openNote: setOpenNote,
      newNote: newUntitledNote,
      openDailyNote,
      openThread,
      syncNow,
      openSettings: onOpenSettings,
      openTrash: () => setTrashOpen(true),
      openInSplit,
      closeSplit: splitPath === null ? null : closeSplit,
      exportPdf:
        focusedPath === null
          ? null
          : () => {
              exportNoteAsPdf(printTitleForPath(focusedPath));
            },
    }),
    [
      setOpenNote,
      newUntitledNote,
      openDailyNote,
      openThread,
      syncNow,
      onOpenSettings,
      openInSplit,
      closeSplit,
      splitPath,
      focusedPath,
    ],
  );

  const threads = threadsQuery.data?.threads ?? EMPTY_THREADS;

  return (
    <VaultProvider
      initialPath={openNote}
      onOpenPath={onOpenNote}
      actionsRef={actionsRef}
      panesRef={panesRef}
      onFocusedPathChange={setFocusedPath}
      onFocusedPaneChange={setFocusedPane}
      onOpenInSplit={openInSplit}
    >
      <SidebarProvider
        className="h-dvh overflow-hidden bg-surface text-ink print:h-auto print:overflow-visible"
        open={railOpen && !zen}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setZen(false);
          }
          setRailOpen(nextOpen);
        }}
        persist={false}
        peek="click"
        width={initialSidebarWidth}
      >
        <SidebarWidthPersistence />
        <Sidebar variant="floating" className="print:hidden">
          <SidebarRailContent
            openPath={openNote}
            onOpenFile={setOpenNote}
            ops={treeOps}
            onSyncNow={syncNow}
            onOpenSettings={onOpenSettings}
            onOpenTrash={() => {
              setTrashOpen(true);
            }}
            onOpenSearch={() => {
              setPaletteQuery("");
              setPaletteOpen(true);
            }}
          />
        </Sidebar>
        <SidebarInset className="relative bg-surface">
          <SidebarProvider
            className="min-h-0 h-full flex-1"
            open={panelOpen && !zen}
            onOpenChange={(nextOpen) => {
              if (nextOpen) {
                setZen(false);
              }
              setPanelOpenPersisted(nextOpen);
            }}
            persist={false}
            width="20rem"
          >
            <SidebarInset className="relative bg-surface">
              {zen ? null : (
                <NoteTopbar
                  path={focusedPath}
                  canBack={canBack}
                  canForward={canForward}
                  onBack={() => {
                    historyGo(-1);
                  }}
                  onForward={() => {
                    historyGo(1);
                  }}
                  onOpenSearch={() => {
                    setPaletteQuery("");
                    setPaletteOpen(true);
                  }}
                  commentCount={openCommentCount}
                  onOpenComments={() => {
                    setPanelOpenPersisted(true);
                    setPanelTab("comments");
                  }}
                  onOpenInSplit={() => {
                    const path = focusedPathRef.current;
                    if (path !== null) openInSplit(path);
                  }}
                  onExportPdf={() => {
                    const path = focusedPathRef.current;
                    if (path !== null) exportNoteAsPdf(printTitleForPath(path));
                  }}
                />
              )}
              <div className="flex min-h-0 flex-1 print:block" ref={paneRowRef}>
                <div
                  className={cn(
                    "min-h-0 min-w-0 overflow-y-auto print:overflow-visible",
                    splitPath === null ? "flex-1" : "print:w-full",
                    splitPath !== null && focusedPane === "split" && "print:hidden",
                  )}
                  style={splitPath === null ? undefined : { width: `${String(splitRatio * 100)}%` }}
                  onPointerDownCapture={() => panesRef.current?.focus("primary")}
                >
                  <EditorPane />
                </div>
                {splitPath !== null ? (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    className="w-1 shrink-0 cursor-col-resize bg-line hover:bg-border print:hidden"
                    onPointerDown={onDividerPointerDown}
                  />
                ) : null}
                {splitPath !== null ? (
                  <div
                    className={cn(
                      "flex min-h-0 min-w-0 flex-1 flex-col",
                      focusedPane === "primary" && "print:hidden",
                    )}
                    onPointerDownCapture={() => panesRef.current?.focus("split")}
                  >
                    <SplitPane path={splitPath} onOpenPath={onSplitOpenPath}>
                      <div className="flex items-center justify-end border-b border-line px-2 py-1 print:hidden">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Close split"
                          onClick={closeSplit}
                        >
                          <XIcon />
                        </Button>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
                        <EditorPane />
                      </div>
                    </SplitPane>
                  </div>
                ) : null}
              </div>
              <ActionComposer
                open={composerOpen}
                onOpenChange={setComposerOpen}
                seed={composerSeed}
                docPath={focusedPath}
                readViewContext={readViewContext}
                onLaunched={openThread}
              />
            </SidebarInset>
            <Sidebar side="right" className="print:hidden">
              <ActionsPanel
                docPath={focusedPath}
                tab={panelTab}
                onTabChange={setPanelTab}
                commentFocus={commentFocus}
                selectedThreadId={panelThreadId}
                onSelectThread={setPanelThreadId}
                onOpenDoc={setOpenNote}
              />
            </Sidebar>
          </SidebarProvider>
        </SidebarInset>
        <CommandPalette
          open={paletteOpen}
          initialQuery={paletteQuery}
          onOpenChange={setPaletteOpen}
          entries={treeEntries}
          threads={threads}
          searchSource={searchSource}
          canSync={canSync}
          actions={paletteActions}
        />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSyncNow={syncNow} />
        <TrashDialog open={trashOpen} onOpenChange={setTrashOpen} onOpenNote={setOpenNote} />
        <ConfirmDialogHost />
        <Toaster position="bottom-right" />
      </SidebarProvider>
    </VaultProvider>
  );
}

/** Mirrors the rail's drag-resized width back into the localStorage pref the
 *  provider is seeded from, so the width survives a reload. Rendered inside
 *  SidebarProvider — the width lives in its context. */
function SidebarWidthPersistence() {
  const { width } = useSidebar();
  useEffect(() => {
    const px = Number.parseInt(width, 10);
    if (Number.isFinite(px)) {
      writeSidebarWidth(px);
    }
  }, [width]);
  return null;
}
