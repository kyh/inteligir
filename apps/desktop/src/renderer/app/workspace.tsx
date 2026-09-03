import { docStem } from "@repo/notes/knowledge/doc-file";
import type { ViewContext } from "@repo/domain/view-context";
import type { ViewContextSource } from "./thread-activity";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { orpc } from "./api";
import { setCommentActions } from "@repo/editor/comments/comment-store";
import { ActionComposer } from "./actions/action-composer";
import { ActionsPanel, type PanelTab } from "./actions/actions-panel";
import { useNoteComments, useNoteCommentMeta } from "./actions/comment-hooks";
import { NoteTopbar } from "./note-topbar";
import { useThreads } from "./actions/thread-hooks";
import { platformShortcutModifier, useGlobalShortcuts } from "./global-shortcuts";
import { setAgentRequestActions } from "@repo/editor/agent-request";
import { consumeSearchRequest, useSearchRequest } from "@repo/editor/search-request";
import { EditorColumn } from "@repo/editor/editor-column";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { openDocPath } from "@repo/editor/note/open-doc";
import { backTarget, createOpenNoteStore, forwardTarget } from "@repo/editor/note/open-note-store";
import { exportNoteAsPdf } from "./note/export-pdf";
import type { VaultActions } from "@repo/editor/host-io";
import { dailyNotePath, dailyNoteTemplate } from "./note/daily";
import { readNoteViewContext } from "./note/note-view-context";
import { VaultProvider } from "./note/vault-provider";
import { CommandPalette } from "./palette/command-palette";
import { createSearchSource, sortedNotePaths } from "./palette/search-source";
import { DeletedNotesDialog } from "./sidebar/deleted-notes-dialog";
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
import { readSidebarWidth, writeSidebarWidth, readPanelOpen, writePanelOpen } from "./prefs";
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
  const [paletteQuery, setPaletteQuery] = useState("");
  const [deletedNotesOpen, setDeletedNotesOpen] = useState(false);
  const [shortcutModifier] = useState(platformShortcutModifier);

  // The action surface's state lives beside the note, never above it, so no
  // agent interaction can remount the editor.
  const threadsQuery = useThreads();
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSeed, setComposerSeed] = useState<string | null>(null);
  const [zen, setZen] = useState(false);
  // Narrow selectors only: the store settles on every keystroke.
  const noteStore = useMemo(() => createOpenNoteStore(), []);
  const openPath = useStore(noteStore.store, (state) => state.openPath);
  // Trails `openPath` across a switch; the comment tint keys on it.
  const loadedPath = useStore(noteStore.store, (state) => openDocPath(state.openDoc));
  const back = useStore(noteStore.store, backTarget);
  const forward = useStore(noteStore.store, forwardTarget);

  const [panelThreadId, setPanelThreadId] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = useState<boolean>(() => readPanelOpen());
  const [panelTab, setPanelTab] = useState<PanelTab>("actions");
  const setPanelOpenPersisted = useCallback((open: boolean): void => {
    setPanelOpen(open);
    writePanelOpen(open);
  }, []);
  // Here, not in the panel: the top bar's badge counts while the panel is collapsed.
  const commentsQuery = useNoteComments(openPath);
  const openCommentCount = (commentsQuery.data?.threads ?? []).filter(
    (thread) => !thread.resolved,
  ).length;

  useNoteCommentMeta(loadedPath);

  const openThread = useCallback((threadId: string | null): void => {
    setPanelThreadId(threadId);
  }, []);

  // `create` flushes before adding: the route derives `anchored` from disk.
  const [commentFocus, setCommentFocus] = useState<{
    ids: readonly string[];
    nonce: number;
  } | null>(null);
  useEffect(() => {
    setCommentActions({
      create: async (id, text) => {
        const { openPath: path } = noteStore.state();
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
  }, [api, queryClient, noteStore]);

  const readViewContext = useCallback<ViewContextSource>(async (): Promise<ViewContext | null> => {
    const path = noteStore.state().editor.path;
    if (path === null) {
      return null;
    }
    return readNoteViewContext(path, {
      flush: async () => {
        await flushOpenNote();
      },
      read: () => {
        const current = noteStore.state().editor;
        return { content: current.path === path ? current.content : "" };
      },
    });
  }, [noteStore]);

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

  // Ordinary opens: the store's stacks recognize a back/forward move by value.
  const goTo = useCallback((target: string | null): void => {
    if (target === null) return;
    actionsRef.current?.openFile(target);
  }, []);

  const [railOpen, setRailOpen] = useState(true);
  const [initialSidebarWidth] = useState(() => `${String(readSidebarWidth())}px`);

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
    // Create-exclusive rather than checking the tree first, which can be stale.
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

  // Adopted during render, consumed after commit, and cleared only once the
  // palette is open on it: that keeps a StrictMode re-fire idempotent, and the
  // paletteOpen guard keeps a re-fire from clobbering a box being typed in.
  const searchRequest = useSearchRequest((state) => state.query);
  if (searchRequest !== null && !paletteOpen) {
    setPaletteQuery(searchRequest);
    setPaletteOpen(true);
  }
  useEffect(() => {
    if (searchRequest !== null && paletteOpen && paletteQuery === searchRequest) {
      consumeSearchRequest();
    }
  }, [searchRequest, paletteOpen, paletteQuery]);

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
      openDeletedNotes: () => setDeletedNotesOpen(true),
      exportPdf:
        openPath === null
          ? null
          : () => {
              exportNoteAsPdf(docStem(openPath));
            },
    }),
    [setOpenNote, newUntitledNote, openDailyNote, openThread, syncNow, onOpenSettings, openPath],
  );

  const threads = threadsQuery.data?.threads ?? EMPTY_THREADS;

  return (
    <VaultProvider
      initialPath={openNote}
      onOpenPath={onOpenNote}
      actionsRef={actionsRef}
      store={noteStore}
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
            onOpenDeletedNotes={() => {
              setDeletedNotesOpen(true);
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
            width="20rem"
          >
            <SidebarInset className="relative bg-surface">
              {zen ? null : (
                <NoteTopbar
                  path={openPath}
                  railOpen={railOpen && !zen}
                  onToggleRail={() => {
                    setZen(false);
                    setRailOpen((open) => !open);
                  }}
                  canBack={back !== null}
                  canForward={forward !== null}
                  onBack={() => {
                    goTo(back);
                  }}
                  onForward={() => {
                    goTo(forward);
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
                    const { openPath: path } = noteStore.state();
                    if (path !== null) exportNoteAsPdf(docStem(path));
                  }}
                />
              )}
              <div
                data-editor-scroller=""
                className="min-h-0 flex-1 overflow-y-auto print:overflow-visible"
              >
                <EditorColumn />
              </div>
              <ActionComposer
                open={composerOpen}
                onOpenChange={setComposerOpen}
                seed={composerSeed}
                docPath={openPath}
                readViewContext={readViewContext}
                onLaunched={openThread}
              />
            </SidebarInset>
            <Sidebar side="right" className="print:hidden">
              <ActionsPanel
                docPath={openPath}
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
        <DeletedNotesDialog
          open={deletedNotesOpen}
          onOpenChange={setDeletedNotesOpen}
          onOpenNote={setOpenNote}
        />
      </SidebarProvider>
    </VaultProvider>
  );
}

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
