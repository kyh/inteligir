// The workspace frame: the notes rail | editor column | actions panel, with
// the action composer (⌘K), the command palette (⌘P), the daily note (⌘D) and
// the settings dialog hung off it. The open note is the route's `note` search
// param — deep-linkable, back/forward works — mirrored to localStorage so a
// fresh boot reopens where the user left off.

import { docStem } from "@repo/notes/knowledge/doc-file";
import type { ViewContext } from "@repo/domain/view-context";
import type { ViewContextSource } from "./chat-model";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { Toaster } from "@repo/ui/components/sonner";
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
import { EditorPane } from "@repo/editor/editor-pane";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { openDocPath } from "@repo/editor/note/open-doc";
import { backTarget, createOpenNoteStore, forwardTarget } from "@repo/editor/note/open-note-store";
import { exportNoteAsPdf } from "./note/export-pdf";
import type { VaultActions } from "@repo/editor/host";
import { dailyNotePath, dailyNoteTemplate } from "./note/daily";
import { readNoteViewContext } from "./note/note-view-context";
import { VaultProvider } from "./note/vault-provider";
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
  // The open note's one store, owned here so the shell and the vault session
  // read and write the same instance. Every read below is a narrow selector —
  // the store settles on every keystroke.
  const noteStore = useMemo(() => createOpenNoteStore(), []);
  const openPath = useStore(noteStore.store, (state) => state.openPath);
  // The note whose BYTES are on screen, which trails `openPath` across a
  // switch — what the comment tint has to key on.
  const loadedPath = useStore(noteStore.store, (state) => openDocPath(state.openDoc));
  const back = useStore(noteStore.store, backTarget);
  const forward = useStore(noteStore.store, forwardTarget);

  const [panelThreadId, setPanelThreadId] = useState<string | null>(null);

  // The right panel: fluid sidebar state (persisted) + the lifted tab, so the
  // top bar's comment button can aim the panel.
  const [panelOpen, setPanelOpen] = useState<boolean>(() => readPanelOpen());
  const [panelTab, setPanelTab] = useState<PanelTab>("actions");
  const setPanelOpenPersisted = useCallback((open: boolean): void => {
    setPanelOpen(open);
    writePanelOpen(open);
  }, []);
  // Mounted here, not in the panel: the top bar's badge counts the open note's
  // threads whether the panel is showing or collapsed. The panel's own call
  // shares this query.
  const commentsQuery = useNoteComments(openPath);
  const openCommentCount = (commentsQuery.data?.threads ?? []).filter(
    (thread) => !thread.resolved,
  ).length;

  useNoteCommentMeta(loadedPath);

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

  // What the user is looking at, pulled at submit: the open note's buffer via
  // the store the editor publishes into. Selection offsets return with the
  // composer surface (#587) — until then the context names the note whole.
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
        return {
          content: current.path === path ? current.content : "",
          from: 0,
          to: 0,
        };
      },
    });
  }, [noteStore]);

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

  // Back and Forward are ordinary opens on a remembered path: the store's own
  // stacks recognize the move by value, so the arrows carry no bookkeeping of
  // their own.
  const goTo = useCallback((target: string | null): void => {
    if (target === null) return;
    actionsRef.current?.openFile(target);
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
  // seam: adopt-then-consume, so a later ⌘P opens on an empty box. The
  // paletteOpen guard keeps a re-fire from clobbering a box the user is already
  // typing in; a request that lands while it IS open stays pending until it
  // closes. Adopting during render and consuming after commit splits what was
  // one effect, and the two halves are joined by the box itself: the request is
  // honored — and cleared — only once the palette is open ON it, which is also
  // what keeps a StrictMode re-fire idempotent.
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
      openTrash: () => setTrashOpen(true),
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
                <EditorPane />
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
