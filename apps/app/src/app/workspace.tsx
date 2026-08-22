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
import { Toaster, toast } from "@repo/ui/components/sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryKeys, refusalMessage, unwrap } from "./api";
import { setCommentActions } from "@repo/editor/comments/comment-store";
import { ActionComposer } from "./actions/action-composer";
import { ActionsPanel } from "./actions/actions-panel";
import { useThreads } from "./chat/thread-hooks";
import { platformShortcutModifier, useGlobalShortcuts } from "./global-shortcuts";
import { EditorPane } from "@repo/editor/editor-pane";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { openNoteState } from "@repo/editor/note/open-note-store";
import type { VaultActions } from "@repo/editor/host";
import { dailyNotePath, dailyNoteTemplate } from "./note/daily";
import { readNoteViewContext } from "./note/note-view-context";
import { VaultProvider } from "./note/vault-provider";
import { CommandPalette } from "./palette/command-palette";
import {
  NOTE_SEARCH_LIMIT,
  searchNotesByFilename,
  type NoteSearchSource,
} from "./palette/note-search";
import { SettingsDialog } from "./settings/settings-dialog";
import { Sidebar } from "./sidebar/sidebar";
import type { TreeOps } from "./sidebar/file-tree";
import {
  canSyncNow,
  filePathsLowercased,
  syncNowNotice,
  untitledNotePath,
  useVaultStatus,
  useVaultTree,
} from "./vault-hooks";
import { readSidebarWidth, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, writeSidebarWidth } from "./prefs";
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
  // Read once: the platform does not change under a running window.
  const [shortcutModifier] = useState(platformShortcutModifier);

  // The action surface's state lives HERE, beside the note — never above it,
  // so no agent interaction can remount the editor.
  const threadsQuery = useThreads();
  const [composerOpen, setComposerOpen] = useState(false);
  const [panelThreadId, setPanelThreadId] = useState<string | null>(null);

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
        const path = openNote;
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
        setCommentFocus({ ids, nonce: Date.now() });
      },
    });
    return () => {
      setCommentActions(null);
    };
  }, [api, openNote, queryClient]);

  // What the user is looking at, pulled at submit: the open note's buffer via
  // the store the editor publishes into. Selection offsets return with the
  // composer surface (#587) — until then the context names the note whole.
  const readViewContext = useCallback<ViewContextSource>(async (): Promise<ViewContext | null> => {
    const { editor } = openNoteState();
    if (editor.path === null) {
      return null;
    }
    const path = editor.path;
    return readNoteViewContext(path, {
      flush: async () => {
        await flushOpenNote();
      },
      read: () => {
        const { editor: current } = openNoteState();
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

  // During the drag the width goes straight onto the aside's style — a move
  // per frame must not re-render the whole workspace; ONE setState lands the
  // final width on release.
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const asideRef = useRef<HTMLElement | null>(null);
  const resizingRef = useRef(false);
  const dragWidthRef = useRef(0);
  const onResizePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    resizingRef.current = true;
    dragWidthRef.current = sidebarWidth;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizingRef.current) {
      return;
    }
    const width = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, event.clientX));
    dragWidthRef.current = width;
    if (asideRef.current !== null) {
      asideRef.current.style.width = `${width}px`;
    }
  };
  const onResizePointerUp = (): void => {
    if (resizingRef.current) {
      resizingRef.current = false;
      writeSidebarWidth(dragWidthRef.current);
      setSidebarWidth(dragWidthRef.current);
    }
  };

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
                : "The note is removed from the vault.",
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

  useGlobalShortcuts(shortcutModifier, (action) => {
    switch (action) {
      case "open-action-composer":
        setComposerOpen((current) => !current);
        break;
      case "open-palette":
        setPaletteQuery("");
        setPaletteOpen((current) => !current);
        break;
      case "open-daily-note":
        openDailyNote();
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
        .filter((entry) => entry.kind === "file")
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
    }),
    [setOpenNote, newUntitledNote, openDailyNote, openThread, syncNow, onOpenSettings],
  );

  const threads = threadsQuery.data?.threads ?? EMPTY_THREADS;

  return (
    <VaultProvider initialPath={openNote} onOpenPath={onOpenNote} actionsRef={actionsRef}>
      <div className="flex h-dvh overflow-hidden bg-surface text-ink">
        <aside
          ref={asideRef}
          style={{ width: sidebarWidth }}
          className="shrink-0 border-r border-line bg-sidebar text-sidebar-foreground"
        >
          <Sidebar
            openPath={openNote}
            onOpenFile={setOpenNote}
            ops={treeOps}
            onSyncNow={syncNow}
            onOpenSettings={onOpenSettings}
          />
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          className="w-1 shrink-0 cursor-col-resize hover:bg-line-strong active:bg-line-strong"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EditorPane />
          </div>
          <ActionComposer
            open={composerOpen}
            onOpenChange={setComposerOpen}
            docPath={openNote}
            readViewContext={readViewContext}
            onLaunched={openThread}
          />
        </main>
        <aside className="w-80 shrink-0 border-l border-line bg-surface-inset">
          <ActionsPanel
            docPath={openNote}
            commentFocus={commentFocus}
            selectedThreadId={panelThreadId}
            onSelectThread={setPanelThreadId}
            onOpenDoc={setOpenNote}
          />
        </aside>
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
        <ConfirmDialogHost />
        <Toaster position="bottom-right" />
      </div>
    </VaultProvider>
  );
}
