import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import type { VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@repo/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar";
import { EllipsisIcon } from "lucide-react";
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
}

// One list by recency: folders are the tree view's business.
export const NotesList = ({
  entries,
  scope,
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

  // the menu row: the name is the label, the folder and the age ride its trailing edge, and the
  // row's verbs sit behind an action revealed on hover
  const row = (note: FileEntry) => {
    const hint = folderHint(note.path, scope);
    const isOpen = note.path === openPath;
    const openMenu = (anchor: HTMLElement): void => {
      setMenu({ anchor, path: note.path });
    };
    return (
      <SidebarMenuItem key={note.path}>
        <SidebarMenuButton
          title={note.path}
          isActive={isOpen}
          className={onSetPinned === undefined ? undefined : "pr-8"}
          onClick={() => {
            onOpenFile(note.path);
          }}
          onContextMenu={(event) => {
            if (onSetPinned === undefined) {
              return;
            }
            event.preventDefault();
            openMenu(event.currentTarget);
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
        </SidebarMenuButton>
        {onSetPinned === undefined ? null : (
          <SidebarMenuAction
            showOnHover
            aria-label={`Actions for ${docStem(note.path)}`}
            {...(menu?.path === note.path ? { "data-popup-open": "" } : {})}
            onClick={(event) => {
              openMenu(event.currentTarget);
            }}
          >
            <EllipsisIcon />
          </SidebarMenuAction>
        )}
      </SidebarMenuItem>
    );
  };

  return (
    <>
      <SidebarMenu aria-label="Notes">
        {pinned.length > 0 ? (
          <li className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground uppercase">
            Pinned
          </li>
        ) : null}
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
