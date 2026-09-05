import { docStem } from "@repo/notes/knowledge/doc-file";
import type { ViewContext } from "@repo/domain/view-context";
import type { ViewContextSource } from "./thread-activity";
import type { VaultMatchWire } from "@repo/api/local/knowledge/knowledge-schema";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
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
import { consumeTagRequest, useTagRequest } from "@repo/editor/tag-request";
import { EditorColumn } from "@repo/editor/editor-column";
import { jumpToFindMatch, openFindBar } from "@repo/editor/find-bar";
import { insertTemplate } from "@repo/editor/insert-template";
import { getLiveEditor, whenLiveEditor } from "@repo/editor/live-editor";
import { collectHeadings, goToHeading, type HeadingItem } from "@repo/editor/toc";
import { removeFrontmatterId } from "@repo/notes/markdown/frontmatter";
import { DAILY_TEMPLATE_PATH, expandTemplate } from "@repo/notes/templates/placeholders";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { openDocPath } from "@repo/editor/note/open-doc";
import { backTarget, createOpenNoteStore, forwardTarget } from "@repo/editor/note/open-note-store";
import { exportNoteAsPdf } from "./note/export-pdf";
import type { VaultActions } from "@repo/editor/host-io";
import { dailyNoteFromTemplate, dailyNotePath, dailyNoteTemplate } from "./note/daily";
import { readNoteViewContext } from "./note/note-view-context";
import { setNotePinned } from "./note/pin-note";
import { VaultProvider } from "./note/vault-provider";
import { CommandPalette, type PalettePage } from "./palette/command-palette";
import { createMatchSource } from "./palette/match-source";
import { createSearchSource, sortedNotePaths } from "./palette/search-source";
import {
  replaceInVault,
  summarizeReplace,
  type VaultReplaceRequest,
} from "./palette/vault-replace";
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
  usePinnedPaths,
  useVaultStatus,
  useVaultTree,
} from "./vault-hooks";
import {
  readPanelOpen,
  readSidebarFolder,
  readSidebarWidth,
  writePanelOpen,
  writeSidebarFolder,
  writeSidebarWidth,
} from "./prefs";
import { hasInsetTitleBar } from "./title-bar";
import { useWorkspace } from "./workspace-context";

export interface WorkspaceProps {
  openNote: string | null;
  onOpenNote: (path: string | null) => void;
}

const EMPTY_ENTRIES: readonly VaultEntry[] = [];
const EMPTY_THREADS: readonly Thread[] = [];

// a note that never mounts (a refused open) must not leave a jump waiting forever
const LIVE_EDITOR_WAIT_MS = 5000;

export function Workspace({ openNote, onOpenNote }: WorkspaceProps) {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const treeQuery = useVaultTree();
  const statusQuery = useVaultStatus();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  // the entry a tree "Move to…" opened the palette for; cleared with the palette
  const [paletteMove, setPaletteMove] = useState<string | null>(null);
  const [palettePage, setPalettePage] = useState<PalettePage>("root");
  const [deletedNotesOpen, setDeletedNotesOpen] = useState(false);
  const [shortcutModifier] = useState(platformShortcutModifier);
  const [insetTitleBar] = useState(hasInsetTitleBar);

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
  // owned here, not in the rail: the top bar's breadcrumb sets it too, and both are one prop away
  const [sidebarFolder, setSidebarFolder] = useState<string>(readSidebarFolder);
  const chooseFolder = useCallback((folder: string): void => {
    writeSidebarFolder(folder);
    setSidebarFolder(folder);
  }, []);

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

  // the live editor is keyed by path, so a note mid-switch answers no editor and the bar stays shut
  const findInNote = useCallback((): void => {
    const { openPath: path } = noteStore.state();
    const editor = path === null ? null : getLiveEditor(path);
    if (editor !== null) openFindBar(editor);
  }, [noteStore]);

  // the note opens first; the find bar takes the match once its editor is live
  const openMatch = useCallback(
    (match: VaultMatchWire, query: string): void => {
      setOpenNote(match.path);
      void whenLiveEditor(match.path, LIVE_EDITOR_WAIT_MS).then((editor) => {
        if (editor !== null) jumpToFindMatch(editor, query, match.ordinal);
        return undefined;
      });
    },
    [setOpenNote],
  );

  const replaceAll = useCallback(
    (request: VaultReplaceRequest): void => {
      void (async () => {
        const noteCount = request.paths.length;
        const confirmed = await confirm({
          title: `Replace in ${String(noteCount)} note${noteCount === 1 ? "" : "s"}?`,
          body: `Every match of "${request.needle}" becomes "${request.replacement}". A note stays recoverable from its History.`,
          confirmLabel: "Replace all",
        });
        if (!confirmed) return;
        // the open note's buffer lands first, so its file is not the one that "changed since read"
        await flushOpenNote();
        const summary = summarizeReplace(await replaceInVault(api, request));
        toast[summary.tone](summary.message);
      })();
    },
    [api],
  );

  // the template is read on every ⌘D rather than looked up in the tree, which can be stale; a
  // refused read keeps the built-in shape, so the day's note opens either way.
  const openDailyNote = useCallback((): void => {
    const now = new Date();
    void (async () => {
      let content = dailyNoteTemplate(now);
      try {
        const template = await api.vault.read({ path: DAILY_TEMPLATE_PATH });
        content = dailyNoteFromTemplate(template.content, now);
      } catch {
        // no template in this vault
      }
      // Create-exclusive rather than checking the tree first, which can be stale.
      await createNote(dailyNotePath(now), content);
    })();
  }, [api, createNote]);

  const newNoteFromTemplate = useCallback(
    (templatePath: string): void => {
      void (async () => {
        let template: string;
        try {
          ({ content: template } = await api.vault.read({ path: templatePath }));
        } catch {
          toast.error("Could not read the template.");
          return;
        }
        const path = untitledNotePath("", filePathsLowercased(treeQuery.data));
        const body = expandTemplate(template, { now: new Date(), title: docStem(path) });
        await createNote(path, removeFrontmatterId(body));
      })();
    },
    [api, treeQuery.data, createNote],
  );

  const insertTemplateIntoNote = useCallback(
    (templatePath: string): void => {
      const { openPath: path } = noteStore.state();
      const editor = path === null ? null : getLiveEditor(path);
      if (editor !== null) void insertTemplate(editor, templatePath);
    },
    [noteStore],
  );

  const { syncNow, inFlight: syncInFlight } = useSyncNow();

  const setPinned = useCallback(
    (path: string, pinned: boolean): void => {
      void setNotePinned(api, path, pinned).then((outcome) => {
        if (outcome.kind === "refused") toast.error(outcome.message);
        return undefined;
      });
    },
    [api],
  );
  const pinnedPaths = usePinnedPaths();
  const openPinned = openPath !== null && pinnedPaths.has(openPath);

  const treeOps = useTreeOps({
    api,
    actions: actionsRef,
    createNote,
    openNote,
    setOpenNote,
    setPinned,
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

  // Adopted during render so the rail opens in the same paint; the rail itself
  // consumes the request once it shows the tag.
  const tagRequest = useTagRequest((state) => state.tag);
  const [seenTagRequest, setSeenTagRequest] = useState<string | null>(null);
  if (seenTagRequest !== tagRequest) {
    setSeenTagRequest(tagRequest);
    if (tagRequest !== null) {
      setZen(false);
      setRailOpen(true);
    }
  }

  useGlobalShortcuts(shortcutModifier, (action) => {
    switch (action) {
      case "open-action-composer":
        setComposerSeed(null);
        setComposerOpen((current) => !current);
        break;
      case "open-palette":
        setPaletteQuery("");
        setPalettePage("root");
        setPaletteOpen((current) => !current);
        break;
      case "find-in-note":
        findInNote();
        break;
      case "open-search":
        setPaletteQuery("");
        setPalettePage("search");
        setPaletteOpen(true);
        break;
      case "open-quick-switcher":
        setPaletteQuery("");
        setPalettePage("notes");
        setPaletteOpen(true);
        break;
      case "open-headings":
        setPaletteQuery("");
        setPalettePage("headings");
        setPaletteOpen(true);
        break;
      case "open-settings":
        onOpenSettings();
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
  const matchSource = useMemo(() => createMatchSource(api), [api]);

  const paletteActions = useMemo(
    () => ({
      openNote: setOpenNote,
      newNote: newUntitledNote,
      newNoteFromTemplate,
      openDailyNote,
      openThread,
      syncNow,
      openSettings: onOpenSettings,
      openDeletedNotes: () => setDeletedNotesOpen(true),
      findInNote: openPath === null ? null : findInNote,
      insertTemplate: openPath === null ? null : insertTemplateIntoNote,
      exportPdf:
        openPath === null
          ? null
          : () => {
              exportNoteAsPdf(docStem(openPath));
            },
      moveNote: treeOps.moveEntry,
      pinNote: openPath === null || openPinned ? null : () => setPinned(openPath, true),
      unpinNote: openPath !== null && openPinned ? () => setPinned(openPath, false) : null,
      openMatch,
      replaceAll,
      listHeadings:
        openPath === null
          ? null
          : () => {
              const editor = getLiveEditor(openPath);
              return editor === null ? [] : collectHeadings(editor);
            },
      goToHeading: (heading: HeadingItem) => {
        const { openPath: path } = noteStore.state();
        const editor = path === null ? null : getLiveEditor(path);
        if (editor !== null) goToHeading(editor, heading);
      },
    }),
    [
      setOpenNote,
      newUntitledNote,
      newNoteFromTemplate,
      openDailyNote,
      openThread,
      syncNow,
      onOpenSettings,
      findInNote,
      insertTemplateIntoNote,
      openPath,
      openPinned,
      setPinned,
      treeOps,
      openMatch,
      replaceAll,
      noteStore,
    ],
  );

  const noteMetadata = useMemo(
    () => ({
      setPinned: (pinned: boolean) => {
        const { openPath: path } = noteStore.state();
        if (path !== null) setPinned(path, pinned);
      },
      deleteNote: () => {
        const { openPath: path } = noteStore.state();
        if (path !== null) treeOps.removeEntry(path, "file");
      },
      openDeletedNotes: () => setDeletedNotesOpen(true),
    }),
    [noteStore, treeOps, setPinned],
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
              setPalettePage("root");
              setPaletteOpen(true);
            }}
            onMoveRequest={(path) => {
              setPaletteQuery("");
              setPaletteMove(path);
              setPaletteOpen(true);
            }}
            tagRequest={tagRequest}
            onTagRequestHandled={consumeTagRequest}
            folder={sidebarFolder}
            onFolderChange={chooseFolder}
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
                  insetTitleBar={insetTitleBar}
                  canBack={back !== null}
                  canForward={forward !== null}
                  onBack={() => {
                    goTo(back);
                  }}
                  onForward={() => {
                    goTo(forward);
                  }}
                  onFindInNote={findInNote}
                  onOpenFolder={(folder) => {
                    chooseFolder(folder);
                    setZen(false);
                    setRailOpen(true);
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
                noteMetadata={noteMetadata}
              />
            </Sidebar>
          </SidebarProvider>
        </SidebarInset>
        <CommandPalette
          open={paletteOpen}
          initialQuery={paletteQuery}
          openNotePath={openPath}
          moveRequest={paletteMove}
          initialPage={palettePage}
          modifier={shortcutModifier}
          onOpenChange={(open) => {
            setPaletteOpen(open);
            if (!open) setPaletteMove(null);
          }}
          entries={treeEntries}
          threads={threads}
          searchSource={searchSource}
          matchSource={matchSource}
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
