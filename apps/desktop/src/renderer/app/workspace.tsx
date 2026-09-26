import { docStem } from "@repo/notes/knowledge/doc-file";
import type { TextMatchOptions } from "@repo/notes/knowledge/text-matches";
import type { ViewContext } from "@repo/domain/view-context";
import type { ViewContextSource } from "./thread-activity";
import type { VaultMatchWire } from "@repo/api/local/knowledge/knowledge-schema";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { plural } from "@repo/ui/lib/plural";
import { toast } from "@repo/ui/components/sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { client, orpc } from "./api";
import { setCommentActions } from "@repo/editor/comments/comment-store";
import { ActionComposer } from "./actions/action-composer";
import { ActionsPanel } from "./actions/actions-panel";
import type { PanelTab } from "./actions/actions-panel";
import type { CommentFocus } from "./actions/comments-tab";
import { useNoteComments, useNoteCommentMeta } from "./actions/comment-hooks";
import { NoteTopbar } from "./note-topbar";
import { NoteFooter } from "./note-footer";
import { useThreads } from "./actions/thread-hooks";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { bindingFor, useGlobalShortcuts } from "./global-shortcuts";
import { setAgentRequestActions } from "@repo/editor/agent-request";
import { EditorColumn } from "@repo/editor/editor-column";
import { hideFindBar, jumpToFindMatch, openFindBar } from "@repo/editor/find-bar";
import { insertTemplate } from "@repo/editor/insert-template";
import { scrollToLinkTarget } from "@repo/editor/link-locate";
import { getLiveEditor, whenLiveEditor } from "@repo/editor/live-editor";
import { collectHeadings, goToHeading } from "@repo/editor/toc";
import type { HeadingItem } from "@repo/editor/toc";
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
import type { PinNoteApi } from "./note/pin-note";
import { VaultProvider } from "./note/vault-provider";
import { CommandPalette } from "./palette/command-palette";
import type { PaletteEntry, PaletteRequest } from "./palette/command-palette";
import { replaceInVault, summarizeReplace } from "./palette/vault-replace";
import type { ReplaceProgressPort, VaultReplaceRequest } from "./palette/vault-replace";
import { Sidebar } from "@repo/ui/components/sidebar";
import { SidebarInset, SidebarProvider } from "@repo/ui/components/sidebar-core";
import type { SidebarActions } from "@repo/ui/components/sidebar-core";
import type { SettingsSection } from "./settings/settings-page";
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
import { PREFS, readPref, usePref, writePref } from "./prefs";
import { hasInsetTitleBar } from "./title-bar";

export interface WorkspaceProps {
  // read once, at boot: after that the note store owns the open note and `onOpenNote` mirrors it
  bootNote: string | null;
  onOpenNote: (path: string | null) => void;
  // another surface draws over the workspace: it goes inert and its window-level chords stand
  // down. Its root isolates the z-indices inside, so a later sibling covers every one of them.
  covered: boolean;
}

const EMPTY_ENTRIES: readonly VaultEntry[] = [];
const EMPTY_THREADS: readonly Thread[] = [];

// what the panel is asked to show; a comments reveal with no focus keeps the last one
type PanelReveal =
  | { tab: "actions"; threadId: string }
  | { tab: "comments"; focus?: readonly string[] }
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

const showLinkWhenLive = async (sourcePath: string, target: string): Promise<void> => {
  const editor = await whenLiveEditor(sourcePath, LIVE_EDITOR_WAIT_MS);
  if (editor !== null && !scrollToLinkTarget(editor, target)) {
    jumpToFindMatch(editor, target, 0);
  }
};

const pinAndReport = async (api: PinNoteApi, path: string, pinned: boolean): Promise<void> => {
  const outcome = await setNotePinned(api, path, pinned);
  if (outcome.kind === "refused") {
    toast.error(outcome.message);
  }
};

export const Workspace = ({ bootNote, onOpenNote, covered }: WorkspaceProps) => {
  const queryClient = useQueryClient();
  const treeQuery = useVaultTree();
  const statusQuery = useVaultStatus();

  // Each open is a fresh request, keyed by its nonce so the palette mounts clean. A close keeps
  // the last request mounted with `open` off, because unmounting the dialog cuts its exit tween;
  // the next open replaces it.
  const [palette, setPalette] = useState<{ request: PaletteRequest; open: boolean } | null>(null);
  const openPalette = useCallback((entry: PaletteEntry): void => {
    setPalette((current) => ({
      open: true,
      request: { ...entry, nonce: (current?.request.nonce ?? 0) + 1 },
    }));
  }, []);
  const closePalette = useCallback((): void => {
    setPalette((current) => (current === null ? null : { ...current, open: false }));
  }, []);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [shortcutModifier] = useState(platformShortcutModifier);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [insetTitleBar] = useState(hasInsetTitleBar);

  // The action surface's state lives beside the note, never above it, so no
  // agent interaction can remount the editor.
  const threadsQuery = useThreads();
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSeed, setComposerSeed] = useState<string | null>(null);
  const [zen, setZen] = useState(false);
  // Narrow selectors only: the store settles on every keystroke.
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [noteStore] = useState(createOpenNoteStore);
  const openPath = useStore(noteStore.store, (state) => state.openPath);
  // Trails `openPath` across a switch; the comment tint keys on it.
  const loadedPath = useStore(noteStore.store, (state) => openDocPath(state.openDoc));
  const back = useStore(noteStore.store, backTarget);
  const forward = useStore(noteStore.store, forwardTarget);
  // walked as the headings page opens, never in render: nothing re-renders the workspace when the
  // document changes.
  const listOpenHeadings = useCallback((): readonly HeadingItem[] => {
    const { openPath: path } = noteStore.state();
    const editor = path === null ? null : getLiveEditor(path);
    return editor === null ? [] : collectHeadings(editor);
  }, [noteStore]);

  const [panelThreadId, setPanelThreadId] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = usePref(PREFS.panelOpen);
  const [panelTab, setPanelTab] = useState<PanelTab>("actions");
  // Here, not in the panel: the top bar's badge counts while the panel is collapsed.
  const commentsQuery = useNoteComments(openPath);
  const openCommentCount = (commentsQuery.data?.threads ?? []).filter(
    (thread) => !thread.resolved,
  ).length;

  useNoteCommentMeta(loadedPath);

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

  const [commentFocus, setCommentFocus] = useState<CommentFocus | null>(null);
  // One verb for every entry that shows something in the panel: it starts closed, so an entry
  // that only picks its tab or thread shows nothing.
  const revealPanel = useCallback(
    (target: PanelReveal): void => {
      showPanel(true);
      setPanelTab(target.tab);
      if (target.tab === "actions") {
        setPanelThreadId(target.threadId);
      } else if (target.tab === "comments" && target.focus !== undefined) {
        const ids = target.focus;
        setCommentFocus((current) => ({ ids, nonce: (current?.nonce ?? 0) + 1 }));
      }
    },
    [showPanel],
  );

  const openThread = useCallback(
    (threadId: string): void => {
      revealPanel({ tab: "actions", threadId });
    },
    [revealPanel],
  );

  // `create` flushes before adding: the route derives `anchored` from disk.
  useEffect(() => {
    setCommentActions({
      create: async (id, text) => {
        const { openPath: path } = noteStore.state();
        if (path === null) {
          return false;
        }
        await flushOpenNote();
        try {
          await client.comments.add({ id, path, text });
        } catch {
          return false;
        }
        void queryClient.invalidateQueries({ queryKey: orpc.comments.key() });
        return true;
      },
      open: (ids) => {
        revealPanel({ focus: ids, tab: "comments" });
      },
    });
    return () => {
      setCommentActions(null);
    };
  }, [queryClient, noteStore, revealPanel]);

  const readViewContext = useCallback<ViewContextSource>(async (): Promise<ViewContext | null> => {
    const { editor } = noteStore.state();
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
  }, [noteStore]);

  const actionsRef = useRef<VaultActions | null>(null);
  const noteColumnRef = useRef<HTMLElement | null>(null);
  // Ordinary opens, Back and Forward included: the store's stacks recognize a back/forward move
  // by value.
  const setOpenNote = useCallback((path: string | null): void => {
    if (path === null) {
      return;
    }
    actionsRef.current?.openFile(path);
  }, []);

  const showHistory = useCallback(
    (path: string): void => {
      setOpenNote(path);
      revealPanel({ tab: "history" });
    },
    [setOpenNote, revealPanel],
  );

  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [initialSidebarWidth] = useState(() => `${String(readPref(PREFS.sidebarWidth))}px`);
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [initialPanelWidth] = useState(() => `${String(readPref(PREFS.panelWidth))}px`);
  // the rail's view and its tag, owned here for the same reason: a `#tag` chip deep in the note
  // sets both, and it reaches the shell through the editor's action registry
  const [railView, chooseRailView] = usePref(PREFS.railView);
  // The breadcrumb's ask, keyed by a nonce so naming the same folder twice reveals it twice; the
  // tree consumes it, so the rail shows Files first. The nonce is counted here rather than off
  // the ask, which is cleared once the tree has focused it.
  const [reveal, setReveal] = useState<{ path: string; nonce: number } | null>(null);
  const revealNonce = useRef(0);
  const revealInTree = useCallback(
    (path: string): void => {
      chooseRailView("files");
      revealNonce.current += 1;
      setReveal({ nonce: revealNonce.current, path });
    },
    [chooseRailView],
  );
  const clearReveal = useCallback((): void => {
    setReveal(null);
  }, []);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

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
    if (editor !== null) {
      openFindBar(editor);
    }
  }, [noteStore]);

  // the note opens first; the find bar takes the match once its editor is live
  const openMatch = useCallback(
    (match: VaultMatchWire, needle: string, options: TextMatchOptions): void => {
      setOpenNote(match.path);
      void jumpWhenLive(match.path, needle, match.ordinal, options);
    },
    [setOpenNote],
  );

  // the link element itself when the note still carries it; else the find bar shows the target
  const openProblemLink = useCallback(
    (sourcePath: string, target: string): void => {
      setOpenNote(sourcePath);
      void showLinkWhenLive(sourcePath, target);
    },
    [setOpenNote],
  );

  // settles when the run is over, so the palette can show it running and offer the cancel
  const replaceAll = useCallback(
    async (request: VaultReplaceRequest, port: ReplaceProgressPort): Promise<void> => {
      const noteCount = request.paths.length;
      const confirmed = await confirm({
        body: `Every match of "${request.needle}" becomes "${request.replacement}". A note stays recoverable from its History.`,
        confirmLabel: "Replace all",
        title: `Replace in ${plural(noteCount, "note")}?`,
      });
      if (!confirmed) {
        return;
      }
      // the open note's buffer lands first, so its file is not the one that "changed since read"
      await flushOpenNote();
      const outcomes = await replaceInVault(client, request, port);
      const summary = summarizeReplace(outcomes, noteCount - outcomes.length);
      toast[summary.tone](summary.message);
    },
    [],
  );

  // the template is read on every ⌘D rather than looked up in the tree, which can be stale; a
  // refused read keeps the built-in shape, so the day's note opens either way.
  const openDailyNote = useCallback((): void => {
    const now = new Date();
    void (async () => {
      let content = dailyNoteTemplate(now);
      try {
        const template = await client.vault.read({ path: DAILY_TEMPLATE_PATH });
        content = dailyNoteFromTemplate(template.content, now);
      } catch {
        // no template in this vault
      }
      // Create-exclusive rather than checking the tree first, which can be stale.
      await createNote(dailyNotePath(now), content);
    })();
  }, [createNote]);

  const newNoteFromTemplate = useCallback(
    (templatePath: string): void => {
      void (async () => {
        let template: string;
        try {
          ({ content: template } = await client.vault.read({ path: templatePath }));
        } catch {
          toast.error("Could not read the template.");
          return;
        }
        const path = untitledNotePath("", filePathsLowercased(treeQuery.data));
        const body = expandTemplate(template, { now: new Date(), title: docStem(path) });
        await createNote(path, removeFrontmatterId(body));
      })();
    },
    [treeQuery.data, createNote],
  );

  const insertTemplateIntoNote = useCallback(
    (templatePath: string): void => {
      const { openPath: path } = noteStore.state();
      const editor = path === null ? null : getLiveEditor(path);
      if (editor !== null) {
        void insertTemplate(editor, templatePath);
      }
    },
    [noteStore],
  );

  const { syncNow, inFlight: syncInFlight } = useSyncNow();

  const setPinned = useCallback((path: string, pinned: boolean): void => {
    void pinAndReport(client, path, pinned);
  }, []);
  const pinnedPaths = usePinnedPaths();
  const openPinned = openPath !== null && pinnedPaths.has(openPath);

  const treeOps = useTreeOps({
    actions: actionsRef,
    createNote,
    setPinned,
  });

  const navigate = useNavigate();
  // Settings covers a workspace that stays mounted, so no unmount settles a title mid-rename or
  // an edit inside the autosave debounce: the blur and the flush stand in for it. The palette and
  // the find bar are portaled, so the cover would hide neither: both close here.
  const onOpenSettings = useCallback(
    (section?: SettingsSection): void => {
      closePalette();
      const { openPath: path } = noteStore.state();
      const editor = path === null ? null : getLiveEditor(path);
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
    },
    [closePalette, noteStore, navigate],
  );

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
      showTag: (tag) => {
        showRail(true);
        chooseRailView("recent");
        setSelectedTag(tag);
      },
    });
    return () => {
      setAgentRequestActions(null);
    };
  }, [chooseRailView, showRail]);

  useGlobalShortcuts({ enabled: !covered, modifier: shortcutModifier }, (action) => {
    switch (action) {
      case "open-action-composer": {
        setComposerSeed(null);
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
      case "open-daily-note": {
        openDailyNote();
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

  const paletteActions = useMemo(
    () => ({
      goToHeading: (heading: HeadingItem) => {
        const { openPath: path } = noteStore.state();
        const editor = path === null ? null : getLiveEditor(path);
        if (editor !== null) {
          goToHeading(editor, heading);
        }
      },
      moveNote: treeOps.moveEntry,
      newNote: newUntitledNote,
      newNoteFromTemplate,
      note:
        openPath === null
          ? null
          : {
              exportPdf: () => {
                exportNoteAsPdf(docStem(openPath));
              },
              findInNote,
              insertTemplate: insertTemplateIntoNote,
              listHeadings: listOpenHeadings,
              path: openPath,
              pinned: openPinned,
              togglePin: () => {
                setPinned(openPath, !openPinned);
              },
            },
      openDailyNote,
      openDeletedNotes: () => {
        chooseRailView("deleted");
      },
      openMatch,
      openNote: setOpenNote,
      openProblemLink,
      openSettings: () => {
        onOpenSettings();
      },
      openThread,
      replaceAll,
      syncNow,
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
      openProblemLink,
      chooseRailView,
      listOpenHeadings,
    ],
  );

  const noteMetadata = useMemo(
    () => ({
      deleteNote: () => {
        const { openPath: path } = noteStore.state();
        if (path !== null) {
          treeOps.removeEntry(path, "file");
        }
      },
      openDeletedNotes: () => {
        chooseRailView("deleted");
      },
      setPinned: (pinned: boolean) => {
        const { openPath: path } = noteStore.state();
        if (path !== null) {
          setPinned(path, pinned);
        }
      },
    }),
    [noteStore, treeOps, setPinned, chooseRailView],
  );

  const threads = threadsQuery.data ?? EMPTY_THREADS;

  return (
    <VaultProvider
      initialPath={bootNote}
      onOpenPath={onOpenNote}
      onShowHistory={showHistory}
      actionsRef={actionsRef}
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
          peek="click"
          width={initialSidebarWidth}
        >
          <Sidebar variant="floating" className="h-full print:hidden">
            <SidebarRailContent
              openPath={openPath}
              onOpenFile={setOpenNote}
              ops={treeOps}
              onMoveRequest={(path) => {
                openPalette({ page: "move-to-folder", subject: path });
              }}
              view={railView}
              onViewChange={chooseRailView}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
              reveal={reveal}
              onRevealConsumed={clearReveal}
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
                {zen ? null : (
                  <NoteTopbar
                    path={openPath}
                    railOpen={railOpen && !zen}
                    onToggleRail={() => {
                      railActionsRef.current?.toggle();
                    }}
                    insetTitleBar={insetTitleBar}
                    canBack={back !== null}
                    canForward={forward !== null}
                    onBack={() => {
                      setOpenNote(back);
                    }}
                    onForward={() => {
                      setOpenNote(forward);
                    }}
                    onFindInNote={findInNote}
                    onOpenFolder={(folder) => {
                      revealInTree(folder);
                      showRail(true);
                    }}
                    commentCount={openCommentCount}
                    onOpenComments={() => {
                      revealPanel({ tab: "comments" });
                    }}
                    onExportPdf={() => {
                      const { openPath: path } = noteStore.state();
                      if (path !== null) {
                        exportNoteAsPdf(docStem(path));
                      }
                    }}
                  />
                )}
                <div
                  data-editor-scroller=""
                  className="min-h-0 flex-1 overflow-y-auto print:overflow-visible"
                >
                  <EditorColumn />
                </div>
                {zen ? null : <NoteFooter path={openPath} />}
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
                  docPath={openPath}
                  readViewContext={readViewContext}
                  onLaunched={openThread}
                  container={noteColumnRef}
                />
              </SidebarInset>
              <Sidebar side="right" className="h-full print:hidden">
                <ActionsPanel
                  docPath={openPath}
                  tab={panelTab}
                  onTabChange={setPanelTab}
                  commentFocus={commentFocus}
                  selectedThreadId={panelThreadId}
                  onSelectThread={setPanelThreadId}
                  onOpenDoc={setOpenNote}
                  noteMetadata={noteMetadata}
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
    </VaultProvider>
  );
};
