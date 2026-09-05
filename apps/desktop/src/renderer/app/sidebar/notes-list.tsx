import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { dirnamePath } from "@repo/notes/knowledge/vault-path";
import type { VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@repo/ui/components/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar";
import { useState } from "react";
import { relativeTimeLabel, useNow } from "../relative-time";
import { usePinnedPaths } from "../vault-hooks";

type FileEntry = Extract<VaultTreeResponse["entries"][number], { kind: "file" }>;

// the folder a note sits in, spelled from the listing's scope; empty at the scope itself
export function folderHint(path: string, scope: string): string {
  const dir = dirnamePath(path);
  if (scope === "") return dir;
  return dir === scope ? "" : dir.slice(scope.length + 1);
}

export interface NotesListProps {
  entries: VaultTreeResponse["entries"];
  scope: string;
  openPath: string | null;
  onOpenFile: (path: string) => void;
  emptyText?: string;
  // absent, a row has no menu
  onSetPinned?: (path: string, pinned: boolean) => void;
}

// One list by recency: folders are the tree view's business.
export function NotesList({
  entries,
  scope,
  openPath,
  onOpenFile,
  emptyText = "No notes yet.",
  onSetPinned,
}: NotesListProps) {
  const pinnedPaths = usePinnedPaths();
  const now = useNow();
  const [menu, setMenu] = useState<{ path: string; anchor: HTMLElement } | null>(null);
  const notes = entries
    .filter((entry): entry is FileEntry => entry.kind === "file" && isDocPath(entry.path))
    .toSorted((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));

  if (notes.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</p>;
  }

  const pinned = notes.filter((note) => pinnedPaths.has(note.path));
  const rest = notes.filter((note) => !pinnedPaths.has(note.path));

  const row = (note: FileEntry) => {
    const hint = folderHint(note.path, scope);
    return (
      <SidebarMenuItem key={note.path}>
        <SidebarMenuButton
          isActive={note.path === openPath}
          title={note.path}
          onClick={() => {
            onOpenFile(note.path);
          }}
          onContextMenu={(event) => {
            if (onSetPinned === undefined) return;
            event.preventDefault();
            setMenu({ path: note.path, anchor: event.currentTarget });
          }}
        >
          <span className="truncate">{docStem(note.path)}</span>
          {hint === "" ? null : (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">{hint}</span>
          )}
          {note.modifiedMs === undefined ? null : (
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {relativeTimeLabel(note.modifiedMs, now)}
            </span>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <>
      {pinned.length > 0 ? (
        <SidebarGroup collapsible>
          <SidebarGroupLabel>Pinned</SidebarGroupLabel>
          <SidebarMenu>{pinned.map(row)}</SidebarMenu>
        </SidebarGroup>
      ) : null}
      {rest.length > 0 ? (
        <SidebarGroup>
          <SidebarMenu>{rest.map(row)}</SidebarMenu>
        </SidebarGroup>
      ) : null}
      <DropdownMenu
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) setMenu(null);
        }}
      >
        {menu !== null ? (
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
        ) : null}
      </DropdownMenu>
    </>
  );
}
