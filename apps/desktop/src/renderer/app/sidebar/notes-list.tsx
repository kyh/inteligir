// The sidebar's default view: pinned notes first (frontmatter
// `pinned: true`, read off the knowledge projection — frontmatter is the only
// property store), then notes ordered by recency with relative timestamps,
// grouped by top-level folder with counts. The file TREE stays one toggle
// away for anyone who thinks in folders; this list answers "what was I
// working on", not "where does it live".

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
import { useEffect, useState } from "react";
import { relativeTimeLabel } from "../relative-time";
import { useWikiTargets } from "../vault-hooks";

type FileEntry = Extract<VaultTreeResponse["entries"][number], { kind: "file" }>;

/** A minute is the finest tier `relativeTimeLabel` distinguishes above "Just
 *  now", so it is also how often these labels can go stale. */
const CLOCK_TICK_MS = 60_000;

/** The clock these labels read. A `Date.now()` during render is an impure read
 *  — the age shown is whatever the last unrelated re-render happened to catch
 *  — so the clock is state, advanced on its own tick. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
    }, CLOCK_TICK_MS);
    return () => {
      clearInterval(tick);
    };
  }, []);
  return now;
}

/** Root notes group under "", folder notes under their FIRST path segment —
 *  the grain a sidebar can show without re-growing the file tree. */
function topFolder(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * Pinned paths off the knowledge projection's wiki targets. Swept by
 * `knowledgeRoot` on every content or file change (workspace-context.tsx), so
 * editing `pinned:` frontmatter moves the note without a dedicated channel.
 */
function usePinnedPaths(): ReadonlySet<string> {
  const query = useWikiTargets();
  const targets = query.data?.targets ?? [];
  return new Set(targets.filter((target) => target.pinned === true).map((target) => target.path));
}

interface NoteGroup {
  folder: string;
  notes: FileEntry[];
}

/** Groups ordered by their freshest note; notes stay recency-sorted within. */
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
    // Trashed notes are restorable, not gone — but the notes LIST is the
    // living vault; Trash/ shows only in the file tree and the trash dialog.
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
