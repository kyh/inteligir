import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import type { VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@repo/ui/components/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@repo/ui/components/sidebar";
import { StarIcon } from "lucide-react";
import { useState } from "react";
import { relativeTimeLabel, useNow } from "../relative-time";
import { usePinnedPaths } from "../vault-hooks";

type FileEntry = Extract<VaultTreeResponse["entries"][number], { kind: "file" }>;

export interface NotesListProps {
  entries: VaultTreeResponse["entries"];
  openPath: string | null;
  onOpenFile: (path: string) => void;
  emptyText?: string;
  // absent, a row has no menu
  onSetPinned?: (path: string, pinned: boolean) => void;
  // the unpinned rows shown, newest first; absent, every one
  limit?: number;
}

// One list by recency, the pinned rows first: folders are the tree view's business.
export const NotesList = ({
  entries,
  openPath,
  onOpenFile,
  emptyText = "No notes yet.",
  onSetPinned,
  limit,
}: NotesListProps) => {
  const pinnedPaths = usePinnedPaths();
  const now = useNow();
  const [menu, setMenu] = useState<{ path: string; anchor: HTMLElement } | null>(null);
  const notes = entries
    .filter((entry): entry is FileEntry => entry.kind === "file" && isDocPath(entry.path))
    .toSorted((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));

  if (notes.length === 0) {
    return <p className="px-2 py-2 text-xs text-muted-foreground">{emptyText}</p>;
  }

  const pinned = notes.filter((note) => pinnedPaths.has(note.path));
  const unpinned = notes.filter((note) => !pinnedPaths.has(note.path));
  const rest = limit === undefined ? unpinned : unpinned.slice(0, limit);

  // the menu row: the name is the label, the folder and the age ride its trailing edge, a pinned
  // row ends in its star, and the row's one verb is a right-click
  const row = (note: FileEntry) => {
    const hint = dirnamePath(note.path);
    const isPinned = pinnedPaths.has(note.path);
    return (
      <SidebarMenuItem key={note.path}>
        <SidebarMenuButton
          title={note.path}
          isActive={note.path === openPath}
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
          {docStem(note.path)}
          {hint === "" ? null : (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">{hint}</span>
          )}
          {note.modifiedMs === undefined ? null : (
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {relativeTimeLabel(note.modifiedMs, now)}
            </span>
          )}
          {isPinned ? (
            <StarIcon
              aria-label="Pinned"
              size={12}
              strokeWidth={1.5}
              className="shrink-0 fill-current text-muted-foreground"
            />
          ) : null}
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <>
      <SidebarMenu aria-label="Notes">
        {pinned.map(row)}
        {rest.map(row)}
      </SidebarMenu>
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
    </>
  );
};
