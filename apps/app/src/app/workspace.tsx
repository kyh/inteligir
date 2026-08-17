// The workspace frame: sidebar (file tree + sync pill) | single-document
// editor column, with the command palette (⌘K), the daily note (⌘D) and the
// settings dialog hung off it. The open note is the route's `note` search
// param — deep-linkable, back/forward works — mirrored to localStorage so a
// fresh boot reopens where the user left off.

import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";
import type { Thread } from "@repo/server-contract/threads";
import type { VaultEntry } from "@repo/server-contract/vault";
import { ConfirmDialogHost, confirm } from "@repo/ui/components/confirm-dialog";
import { Toaster, toast } from "@repo/ui/components/sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, queryKeys, unwrap } from "./api";
import { ChatDock } from "./chat/chat-dock";
import { ANCHOR_FAILURE_MESSAGES, type DelegationDraft } from "./chat/chat-model";
import { createDelegation } from "./chat/chat-service";
import { useThreads } from "./chat/thread-hooks";
import { platformShortcutModifier, useGlobalShortcuts } from "./global-shortcuts";
import { dailyNotePath, dailyNoteTemplate } from "./note/daily";
import { NoteView, type NoteDelegation } from "./note/note-view";
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
  untitledNotePath,
  useVaultStatus,
  useVaultTree,
} from "./vault-hooks";
import {
  readLastOpenNote,
  readSidebarWidth,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  writeLastOpenNote,
  writeSidebarWidth,
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
  // Read once: the platform does not change under a running window.
  const [shortcutModifier] = useState(platformShortcutModifier);

  const onSearchTag = useCallback((tag: string): void => {
    setPaletteQuery(`tag:${tag}`);
    setPaletteOpen(true);
  }, []);

  // The chat dock's state lives HERE, beside the note — never above it, so
  // no chat interaction can remount the editor.
  const threadsQuery = useThreads();
  const [chatExpanded, setChatExpanded] = useState(false);
  const [chatThreadId, setChatThreadId] = useState<string | null>(null);
  const [delegationDraft, setDelegationDraft] = useState<DelegationDraft | null>(null);

  const openThread = useCallback((threadId: string | null): void => {
    setChatThreadId(threadId);
    setChatExpanded(true);
  }, []);

  const runDelegation = useCallback(
    async (draft: DelegationDraft, prompt: string): Promise<void> => {
      try {
        const created = await createDelegation(api, {
          intent: draft.intent,
          docPath: draft.docPath,
          selectionText: draft.selectionText,
          prompt,
          anchor: draft.anchor,
        });
        // An anchor that did not land means NO thread was created — say which
        // failure it was rather than leaving the user with a silent no-op.
        if (created.kind === "not-anchored") {
          toast.error(ANCHOR_FAILURE_MESSAGES[created.reason]);
          return;
        }
        if (created.send.kind === "refused") {
          toast.error(`The delegation could not start: ${created.send.message}`);
        }
        openThread(created.threadId);
      } catch {
        toast.error("Could not create the delegation.");
      } finally {
        void queryClient.invalidateQueries({ queryKey: queryKeys.threadsRoot });
      }
    },
    [api, queryClient, openThread],
  );

  const noteDelegation = useMemo<NoteDelegation>(
    () => ({
      onDraft: setDelegationDraft,
      onRunTask: (draft, prompt) => {
        void runDelegation(draft, prompt);
      },
      onOpenThread: openThread,
    }),
    [runDelegation, openThread],
  );

  // Cancelling drops the editor's tracked position too — an abandoned draft
  // must not leave one armed for the next delegation to inherit.
  const onCancelDraft = useCallback((): void => {
    setDelegationDraft((current) => {
      current?.cancel();
      return null;
    });
  }, []);

  const onSubmitDelegation = useCallback(
    async (prompt: string): Promise<void> => {
      const draft = delegationDraft;
      setDelegationDraft(null);
      if (draft !== null) {
        await runDelegation(draft, prompt);
      }
    },
    [delegationDraft, runDelegation],
  );

  // Every deliberate open/close goes through here, which is what keeps the
  // localStorage mirror honest; the boot restore below bypasses it on purpose.
  const setOpenNote = useCallback(
    (path: string | null): void => {
      writeLastOpenNote(path);
      onOpenNote(path);
    },
    [onOpenNote],
  );

  // Boot restore, one outcome ref: null until the restore ran; "none" while a
  // virgin boot still waits on the tree; "done" once a note was opened (URL,
  // localStorage, or the virgin fallback below).
  const restoreOutcomeRef = useRef<"done" | "none" | null>(null);
  useEffect(() => {
    if (restoreOutcomeRef.current !== null) {
      return;
    }
    if (openNote !== null) {
      restoreOutcomeRef.current = "done";
      return;
    }
    const last = readLastOpenNote();
    if (last !== null) {
      restoreOutcomeRef.current = "done";
      onOpenNote(last);
      return;
    }
    restoreOutcomeRef.current = "none";
  }, [openNote, onOpenNote]);

  // Virgin boot (nothing restored): open the first note in the vault root so
  // the app never lands on an empty pane. Waits for the tree, runs once.
  useEffect(() => {
    if (restoreOutcomeRef.current !== "none" || openNote !== null) {
      return;
    }
    const entries = treeQuery.data?.entries;
    if (entries === undefined) {
      return;
    }
    restoreOutcomeRef.current = "done";
    const firstNote = entries.find(
      (entry) => entry.kind === "file" && !entry.path.includes("/") && entry.path.endsWith(".md"),
    );
    if (firstNote !== undefined) {
      setOpenNote(firstNote.path);
    }
  }, [openNote, treeQuery.data, setOpenNote]);

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

  const createNote = useCallback(
    async (path: string, content = ""): Promise<void> => {
      try {
        // Create-exclusive: an existing note is OPENED, never overwritten.
        await unwrap(await api.vault.file.$put({ json: { path, content, ifAbsent: true } }));
        setOpenNote(path);
      } catch (error) {
        if (error instanceof ApiError && error.code === "already_exists") {
          setOpenNote(path);
          return;
        }
        toast.error(error instanceof ApiError ? error.message : `Could not create ${path}.`);
      }
    },
    [api, setOpenNote],
  );

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
        if (status.state === "conflict") {
          toast.warning("Sync hit a conflict — both sides changed the same files.");
        } else if (status.state === "held") {
          // No pass ran: an agent turn holds the vault's commits. Silence here
          // is indistinguishable from a sync that succeeded.
          toast.info("An agent turn is running — the vault syncs when it finishes.");
        } else if (status.state === "offline") {
          toast.error(
            status.lastError === null
              ? "Could not reach the git remote."
              : `Could not reach the git remote: ${status.lastError}`,
          );
        } else if (status.lastError !== null) {
          toast.error(`Sync failed: ${status.lastError}`);
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
            toast.error(error instanceof ApiError ? error.message : `Could not create ${path}.`);
          }
        })();
      },
      renameEntry: (fromPath, toPath) => {
        void (async () => {
          try {
            await unwrap(await api.vault.rename.$post({ json: { from: fromPath, to: toPath } }));
            if (openNote === fromPath) {
              setOpenNote(toPath);
            } else if (openNote !== null && openNote.startsWith(`${fromPath}/`)) {
              setOpenNote(`${toPath}/${openNote.slice(fromPath.length + 1)}`);
            }
          } catch (error) {
            toast.error(
              error instanceof ApiError && error.status === 409
                ? "That name is already taken."
                : `Could not rename ${fromPath}.`,
            );
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
          try {
            await unwrap(await api.vault.delete.$post({ json: { path } }));
            if (openNote !== null && (openNote === path || openNote.startsWith(`${path}/`))) {
              setOpenNote(null);
            }
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : `Could not delete ${path}.`);
          }
        })();
      },
    }),
    [api, createNote, openNote, setOpenNote],
  );

  const onOpenSettings = useCallback((): void => {
    setSettingsOpen(true);
  }, []);

  const onNoteVanished = useCallback((): void => {
    toast.info("The open note was deleted on disk.");
    setOpenNote(null);
  }, [setOpenNote]);

  useGlobalShortcuts(shortcutModifier, (action) => {
    switch (action) {
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
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside
        ref={asideRef}
        style={{ width: sidebarWidth }}
        className="shrink-0 border-r border-border/60 bg-sidebar text-sidebar-foreground"
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
        className="w-1 shrink-0 cursor-col-resize hover:bg-border active:bg-border"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          {openNote === null ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Open a note from the sidebar, or press{" "}
                <kbd className="rounded border border-border px-1 font-mono text-xs">⌘K</kbd>
              </p>
            </div>
          ) : (
            <NoteView
              path={openNote}
              delegation={noteDelegation}
              onRename={setOpenNote}
              onVanished={onNoteVanished}
              onSearchTag={onSearchTag}
            />
          )}
        </div>
        <ChatDock
          viewThreadId={chatThreadId}
          onViewThread={setChatThreadId}
          expanded={chatExpanded}
          onExpandedChange={setChatExpanded}
          draft={delegationDraft}
          onCancelDraft={onCancelDraft}
          onSubmitDelegation={onSubmitDelegation}
          onOpenDoc={setOpenNote}
        />
      </main>
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
  );
}
