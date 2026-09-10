import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import type { VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@repo/ui/components/dropdown-menu";
import { useSidebarRow } from "@repo/ui/components/sidebar";
import { cn } from "cn";
import { useState } from "react";
import { relativeTimeLabel, useNow } from "../relative-time";
import { usePinnedPaths } from "../vault-hooks";

type FileEntry = Extract<VaultTreeResponse["entries"][number], { kind: "file" }>;

// the folder a note sits in, spelled from the listing's scope; empty at the scope itself
export const folderHint = (path: string, scope: string): string => {
  const dir = dirnamePath(path);
  if (scope === "") {
    return dir;
  }
  return dir === scope ? "" : dir.slice(scope.length + 1);
};

export interface NotesListProps {
  entries: VaultTreeResponse["entries"];
  scope: string;
  openPath: string | null;
  onOpenFile: (path: string) => void;
  emptyText?: string;
  // absent, a row has no menu
  onSetPinned?: (path: string, pinned: boolean) => void;
  // the unpinned rows shown, newest first; absent, every one
  limit?: number;
  // a substring of a name, any case; while set, every match shows and the limit is off
  filter?: string;
}

// the search matches a name, never a folder: the folder hint is where a note is, not what it is
const matchesNoteFilter = (path: string, filter: string): boolean =>
  filter === "" || docStem(path).toLocaleLowerCase().includes(filter.toLocaleLowerCase());

// One list by recency: folders are the tree view's business.
export const NotesList = ({
  entries,
  scope,
  openPath,
  onOpenFile,
  emptyText = "No notes yet.",
  onSetPinned,
  limit,
  filter = "",
}: NotesListProps) => {
  const pinnedPaths = usePinnedPaths();
  const now = useNow();
  const rowClass = useSidebarRow();
  const [menu, setMenu] = useState<{ path: string; anchor: HTMLElement } | null>(null);
  const notes = entries
    .filter(
      (entry): entry is FileEntry =>
        entry.kind === "file" && isDocPath(entry.path) && matchesNoteFilter(entry.path, filter),
    )
    .toSorted((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));

  if (notes.length === 0) {
    return (
      <p className="px-2 py-2 text-xs text-muted-foreground">
        {filter === "" ? emptyText : "No note matches the search."}
      </p>
    );
  }

  const pinned = notes.filter((note) => pinnedPaths.has(note.path));
  const unpinned = notes.filter((note) => !pinnedPaths.has(note.path));
  const rest = limit === undefined || filter !== "" ? unpinned : unpinned.slice(0, limit);

  // the tree's row, so the views read as one list
  const row = (note: FileEntry) => {
    const hint = folderHint(note.path, scope);
    const isOpen = note.path === openPath;
    return (
      <button
        key={note.path}
        type="button"
        title={note.path}
        aria-current={isOpen ? "page" : undefined}
        {...(isOpen ? { "data-active": "" } : {})}
        className={cn(rowClass, "px-2")}
        onClick={() => {
          onOpenFile(note.path);
        }}
        onContextMenu={(event) => {
          if (onSetPinned === undefined) {
            return;
          }
          event.preventDefault();
          setMenu({ anchor: event.currentTarget, path: note.path });
        }}
      >
        <span className="min-w-0 truncate">{docStem(note.path)}</span>
        {hint === "" ? null : (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">{hint}</span>
        )}
        {note.modifiedMs === undefined ? null : (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {relativeTimeLabel(note.modifiedMs, now)}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col py-1">
      {pinned.length > 0 ? (
        <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground uppercase">
          Pinned
        </p>
      ) : null}
      {pinned.map(row)}
      {rest.map(row)}
      <DropdownMenu
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(null);
          }
        }}
      >
        {menu === null ? null : (
          <DropdownMenuContent anchor={menu.anchor} align="start" side="bottom">
            <DropdownMenuItem
              onClick={() => {
                const target = menu.path;
                setMenu(null);
                onSetPinned?.(target, !pinnedPaths.has(target));
              }}
            >
              {pinnedPaths.has(menu.path) ? "Unpin" : "Pin"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    </div>
  );
};
