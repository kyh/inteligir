import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { isTrashedPath } from "@repo/notes/knowledge/vault-path";
import type { VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar";
import { relativeTimeLabel, useNow } from "../relative-time";
import { useWikiTargets } from "../vault-hooks";

type FileEntry = Extract<VaultTreeResponse["entries"][number], { kind: "file" }>;

function topFolder(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function usePinnedPaths(): ReadonlySet<string> {
  const query = useWikiTargets();
  const targets = query.data?.targets ?? [];
  return new Set(targets.filter((target) => target.pinned === true).map((target) => target.path));
}

interface NoteGroup {
  folder: string;
  notes: FileEntry[];
}

function groupByFolder(notes: FileEntry[]): NoteGroup[] {
  const groups = new Map<string, FileEntry[]>();
  for (const note of notes) {
    const folder = topFolder(note.path);
    const members = groups.get(folder);
    if (members === undefined) {
      groups.set(folder, [note]);
    } else {
      members.push(note);
    }
  }
  return [...groups.entries()].map(([folder, members]): NoteGroup => ({ folder, notes: members }));
}

export interface NotesListProps {
  entries: VaultTreeResponse["entries"];
  openPath: string | null;
  onOpenFile: (path: string) => void;
}

export function NotesList({ entries, openPath, onOpenFile }: NotesListProps) {
  const pinnedPaths = usePinnedPaths();
  const now = useNow();
  const notes = entries
    .filter(
      (entry): entry is FileEntry =>
        entry.kind === "file" && isDocPath(entry.path) && !isTrashedPath(entry.path),
    )
    .toSorted((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));

  if (notes.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">No notes yet.</p>;
  }

  const pinned = notes.filter((note) => pinnedPaths.has(note.path));
  const rest = notes.filter((note) => !pinnedPaths.has(note.path));
  const groups = groupByFolder(rest);

  const row = (note: FileEntry) => (
    <SidebarMenuItem key={note.path}>
      <SidebarMenuButton
        isActive={note.path === openPath}
        onClick={() => {
          onOpenFile(note.path);
        }}
      >
        {docStem(note.path)}
        {note.modifiedMs === undefined ? null : (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {relativeTimeLabel(note.modifiedMs, now)}
          </span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <>
      {pinned.length > 0 ? (
        <SidebarGroup collapsible>
          <SidebarGroupLabel>Pinned</SidebarGroupLabel>
          <SidebarMenu>{pinned.map(row)}</SidebarMenu>
        </SidebarGroup>
      ) : null}
      {groups.map((group) =>
        group.folder === "" ? (
          <SidebarGroup key="/">
            <SidebarMenu>{group.notes.map(row)}</SidebarMenu>
          </SidebarGroup>
        ) : (
          <SidebarGroup key={group.folder} collapsible>
            <SidebarGroupLabel>
              {group.folder}
              <span className="ml-auto shrink-0 font-normal text-muted-foreground">
                {group.notes.length}
              </span>
            </SidebarGroupLabel>
            <SidebarMenu>{group.notes.map(row)}</SidebarMenu>
          </SidebarGroup>
        ),
      )}
    </>
  );
}
