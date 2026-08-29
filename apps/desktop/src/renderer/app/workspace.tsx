// The workspace frame: the notes rail | editor column (splittable) | actions
// panel, with the action composer (⌘K), the command palette (⌘P), the daily
// note (⌘D) and the settings dialog hung off it. The open note is the route's `note` search
// param — deep-linkable, back/forward works — mirrored to localStorage so a
// fresh boot reopens where the user left off.

import { docStem } from "@repo/notes/knowledge/doc-file";
import type { ViewContext } from "@repo/domain/view-context";
import type { ViewContextSource } from "./chat-model";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Button } from "@repo/ui/components/button";
import { XIcon } from "lucide-react";
import { cn } from "@repo/ui/lib/utils";
import { Toaster } from "@repo/ui/components/sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { orpc } from "./api";
import { setCommentActions } from "@repo/editor/comments/comment-store";
import { ActionComposer } from "./actions/action-composer";
import { ActionsPanel, type PanelTab } from "./actions/actions-panel";
import { useNoteComments } from "./actions/comment-hooks";
import { NoteTopbar } from "./note-topbar";
import { useThreads } from "./actions/thread-hooks";
import { platformShortcutModifier, useGlobalShortcuts } from "./global-shortcuts";
import { setAgentRequestActions } from "@repo/editor/agent-request";
import { consumeSearchRequest, useSearchRequest } from "@repo/editor/search-request";
import { EditorPane } from "@repo/editor/editor-pane";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { exportNoteAsPdf } from "./note/export-pdf";
import type { VaultActions } from "@repo/editor/host";
import { dailyNotePath, dailyNoteTemplate } from "./note/daily";
import { readNoteViewContext } from "./note/note-view-context";
import { SplitPane, VaultProvider } from "./note/vault-provider";
import { createPaneCoordinator } from "./note/split-view";
import { useNoteHistory } from "./note/note-history";
import { useSplitRatio } from "./note/split-ratio";
import { CommandPalette } from "./palette/command-palette";
import { createSearchSource, sortedNotePaths } from "./palette/search-source";
import { TrashDialog } from "./sidebar/trash-dialog";
import { Sidebar, SidebarInset, SidebarProvider, useSidebar } from "@repo/ui/components/sidebar";
import { SidebarRailContent } from "./sidebar/sidebar";
import { useTreeOps } from "./sidebar/tree-ops";
import { useNavigate } from "@tanstack/react-router";
import {
  canSyncNow,
  filePathsLowercased,
  useSyncNow,
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
  // What the palette's box is seeded with on the next open. ⌘P clears it; a
  // `#tag` chip click sets it to that tag's `tag:` term.
  const [paletteQuery, setPaletteQuery] = useState("");
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
  // The one focus channel: the panes publish into it, the shell selects the
  // two fields it draws with, and action-time callers read it live.
  const coordinator = useMemo(() => createPaneCoordinator(), []);
  const focusedPath = useStore(coordinator.store, (focus) => focus.path);
  const focusedPane = useStore(coordinator.store, (focus) => focus.pane);

  const { ratio: splitRatio, paneRowRef, onDividerPointerDown } = useSplitRatio();

  // ONE note lives in ONE pane. Splitting a note the primary already holds
  // would put two editors and two comment surfaces on one file — two writers
  // racing the same bytes — so the request becomes a focus instead. The rule
  // sits here because every caller reaches this: the palette picks from a list
  // that does not exclude the open note, and a wiki chip can resolve to it.
  const openInSplit = useCallback(
    (path: string): void => {
      if (coordinator.openPath("primary") === path) {
        coordinator.focus("primary");
        return;
      }
      setSplitPath(path);
      writeSplitNote(path);
    },
    [coordinator],
  );
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
  // Mounted here, not in the panel: the top bar's badge counts the focused
  // note's open threads whether the panel is showing or collapsed. The panel's
  // own call shares this query.
  const commentsQuery = useNoteComments(focusedPath);
  const openCommentCount = (commentsQuery.data?.threads ?? []).filter(
    (thread) => !thread.resolved,
  ).length;

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
        const { path } = coordinator.store.getState();
        if (path === null) {
          return false;
        }
        await flushOpenNote();
        try {
          await api.comments.add({ id, path, text });
        } catch {
          return false;
        }
        void queryClient.invalidateQueries({ queryKey: orpc.comments.key() });
        return true;
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
  }, [api, queryClient, coordinator]);

  // What the user is looking at, pulled at submit: the open note's buffer via
  // the store the editor publishes into. Selection offsets return with the
  // composer surface (#587) — until then the context names the note whole.
  const readViewContext = useCallback<ViewContextSource>(async (): Promise<ViewContext | null> => {
    // Null until a pane registers its store: a send fired in that window has
    // no buffer to describe.
    const focused = coordinator.focusedState();
    if (focused === null || focused.editor.path === null) {
      return null;
    }
    const path = focused.editor.path;
    return readNoteViewContext(path, {
      flush: async () => {
        await flushOpenNote();
      },
      read: () => {
        const current = coordinator.focusedState()?.editor;
        return {
          content: current?.path === path ? current.content : "",
          from: 0,
          to: 0,
        };
      },
    });
  }, [coordinator]);

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

  const { canBack, canForward, go: historyGo } = useNoteHistory(openNote, setOpenNote);

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

  const { syncNow, inFlight: syncInFlight } = useSyncNow();

  const treeOps = useTreeOps({
    api,
    actions: actionsRef,
    createNote,
    openNote,
    setOpenNote,
  });

  const navigate = useNavigate();
  const onOpenSettings = useCallback((): void => {
    void navigate({ to: "/settings" });
  }, [navigate]);

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

  // The `#tag` chips' (and deep links') "open the palette on this query"
  // seam: adopt-then-consume, so a later ⌘P opens on an empty box. Idempotent
  // under StrictMode — consuming clears the store, and the paletteOpen guard
  // keeps a re-fire from clobbering a box the user is already typing in.
  const searchRequest = useSearchRequest((state) => state.query);
  useEffect(() => {
    if (searchRequest === null || paletteOpen) return;
    setPaletteQuery(searchRequest);
    setPaletteOpen(true);
    consumeSearchRequest();
  }, [searchRequest, paletteOpen]);

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

  const canSync = canSyncNow(statusQuery.data) && !syncInFlight;

  const treeEntries = treeQuery.data?.entries ?? EMPTY_ENTRIES;
  const sortedFilePaths = useMemo(() => sortedNotePaths(treeEntries), [treeEntries]);
  const searchSource = useMemo(
    () => createSearchSource(api, sortedFilePaths),
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
              exportNoteAsPdf(docStem(focusedPath));
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
      coordinator={coordinator}
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
                  railOpen={railOpen && !zen}
                  onToggleRail={() => {
                    setZen(false);
                    setRailOpen((open) => !open);
                  }}
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
                  onExportPdf={() => {
                    const { path } = coordinator.store.getState();
                    if (path !== null) exportNoteAsPdf(docStem(path));
                  }}
                />
              )}
              <div className="flex min-h-0 flex-1 print:block" ref={paneRowRef}>
                <div
                  data-editor-scroller=""
                  className={cn(
                    "min-h-0 min-w-0 overflow-y-auto print:overflow-visible",
                    splitPath === null ? "flex-1" : "print:w-full",
                    splitPath !== null && focusedPane === "split" && "print:hidden",
                  )}
                  style={splitPath === null ? undefined : { width: `${String(splitRatio * 100)}%` }}
                  onPointerDownCapture={() => {
                    coordinator.focus("primary");
                  }}
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
                    onPointerDownCapture={() => {
                      coordinator.focus("split");
                    }}
                  >
                    <SplitPane
                      path={splitPath}
                      coordinator={coordinator}
                      onOpenPath={onSplitOpenPath}
                    >
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
                      <div
                        data-editor-scroller=""
                        className="min-h-0 flex-1 overflow-y-auto print:overflow-visible"
                      >
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
