// The workspace frame: sidebar (file tree + sync pill) | single-document
// editor column, with the command palette (⌘K), the daily note (⌘D) and the
// settings dialog hung off it. The open note is the route's `note` search
// param — deep-linkable, back/forward works — mirrored to localStorage so a
// fresh boot reopens where the user left off.

import { ConfirmDialogHost, confirm } from "@repo/ui/components/confirm-dialog";
import { Toaster, toast } from "@repo/ui/components/sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, queryKeys, unwrap } from "./api";
import { dailyNotePath, dailyNoteTemplate } from "./note/daily";
import { NoteView } from "./note/note-view";
import { CommandPalette } from "./palette/command-palette";
import { SettingsDialog } from "./settings/settings-dialog";
import { Sidebar } from "./sidebar/sidebar";
import type { TreeOps } from "./sidebar/file-tree";
import { filePathsLowercased, untitledNotePath, useVaultStatus, useVaultTree } from "./vault-hooks";
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

export function Workspace({ openNote, onOpenNote }: WorkspaceProps) {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const treeQuery = useVaultTree();
  const statusQuery = useVaultStatus();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Every deliberate open/close goes through here, which is what keeps the
  // localStorage mirror honest; the boot restore below bypasses it on purpose.
  const setOpenNote = useCallback(
    (path: string | null): void => {
      writeLastOpenNote(path);
      onOpenNote(path);
    },
    [onOpenNote],
  );

  // Boot restore: no note in the URL → reopen the last one, once.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) {
      return;
    }
    restoredRef.current = true;
    if (openNote === null) {
      const last = readLastOpenNote();
      if (last !== null) {
        onOpenNote(last);
      }
    }
  }, [openNote, onOpenNote]);

  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const resizingRef = useRef(false);
  const onResizePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    resizingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizingRef.current) {
      return;
    }
    const width = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, event.clientX));
    setSidebarWidth(width);
  };
  const onResizePointerUp = (): void => {
    if (resizingRef.current) {
      resizingRef.current = false;
      setSidebarWidth((width) => {
        writeSidebarWidth(width);
        return width;
      });
    }
  };

  const createNote = useCallback(
    async (path: string, content = ""): Promise<void> => {
      try {
        await unwrap(await api.vault.file.$put({ json: { path, content } }));
        setOpenNote(path);
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : `Could not create .`);
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
    const path = dailyNotePath(now);
    const exists = filePathsLowercased(treeQuery.data).has(path.toLowerCase());
    if (exists) {
      setOpenNote(path);
    } else {
      void createNote(path, dailyNoteTemplate(now));
    }
  }, [treeQuery.data, createNote, setOpenNote]);

  const syncNow = useCallback((): void => {
    void (async () => {
      try {
        const status = await unwrap(await api.vault.sync.$post());
        queryClient.setQueryData(queryKeys.vaultStatus, status);
        if (status.state === "conflict") {
          toast.warning("Sync hit a conflict — both sides changed the same files.");
        } else if (status.lastError !== null) {
          toast.error(`Sync failed: ${status.lastError}`);
        }
      } catch {
        toast.error("Sync failed.");
      }
    })();
  }, [api, queryClient]);

  const treeOps: TreeOps = {
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
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (event.key === "k") {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      } else if (event.key === "d") {
        event.preventDefault();
        openDailyNote();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openDailyNote]);

  const canSync =
    statusQuery.data !== undefined &&
    statusQuery.data.state !== "no-remote" &&
    statusQuery.data.state !== "syncing";

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside
        style={{ width: sidebarWidth }}
        className="shrink-0 border-r border-border/60 bg-sidebar text-sidebar-foreground"
      >
        <Sidebar
          openPath={openNote}
          onOpenFile={setOpenNote}
          ops={treeOps}
          onSyncNow={syncNow}
          onOpenSettings={() => setSettingsOpen(true)}
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
      <main className="min-w-0 flex-1">
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
            onRename={setOpenNote}
            onVanished={() => {
              toast.info("The open note was deleted on disk.");
              setOpenNote(null);
            }}
          />
        )}
      </main>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        entries={treeQuery.data?.entries ?? []}
        canSync={canSync}
        actions={{
          openNote: setOpenNote,
          newNote: newUntitledNote,
          openDailyNote,
          syncNow,
          openSettings: () => setSettingsOpen(true),
        }}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSyncNow={syncNow} />
      <ConfirmDialogHost />
      <Toaster position="bottom-right" />
    </div>
  );
}
