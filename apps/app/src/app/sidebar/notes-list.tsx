// The sidebar's default view (Moss's IA): pinned notes first (frontmatter
// `pinned: true`, read off the knowledge projection — frontmatter is the only
// property store), then notes ordered by recency with relative timestamps,
// grouped by top-level folder with counts. The file TREE stays one toggle
// away for anyone who thinks in folders; this list answers "what was I
// working on", not "where does it live".

import type { VaultTreeResponse } from "@repo/server-contract/vault";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@repo/ui/lib/utils";
import { queryKeys, unwrap } from "../api";
import { useWorkspace } from "../workspace-context";

type FileEntry = Extract<VaultTreeResponse["entries"][number], { kind: "file" }>;

/** "Just now" → minutes → hours → days → a date. One vocabulary, sidebar-wide. */
function relativeTimeLabel(modifiedMs: number, now: number): string {
  const elapsed = now - modifiedMs;
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${String(Math.floor(elapsed / 60_000))}m ago`;
  if (elapsed < 86_400_000) return `${String(Math.floor(elapsed / 3_600_000))}h ago`;
  if (elapsed < 7 * 86_400_000) return `${String(Math.floor(elapsed / 86_400_000))}d ago`;
  return new Date(modifiedMs).toLocaleDateString();
}

function noteTitle(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/u, "");
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
  const { api } = useWorkspace();
  const query = useQuery({
    queryKey: queryKeys.wikiTargets,
    queryFn: async () => unwrap(await api.knowledge["wiki-targets"].$get()),
  });
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
  const now = Date.now();
  const notes = entries
    .filter((entry): entry is FileEntry => entry.kind === "file" && entry.path.endsWith(".md"))
    .toSorted((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));

  if (notes.length === 0) {
    return <p className="px-3 py-2 text-sm text-ink-3">No notes yet.</p>;
  }

  const pinned = notes.filter((note) => pinnedPaths.has(note.path));
  const rest = notes.filter((note) => !pinnedPaths.has(note.path));
  const groups = groupByFolder(rest);

  const row = (note: FileEntry) => (
    <button
      key={note.path}
      type="button"
      className={cn(
        "flex items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm",
        note.path === openPath
          ? "bg-surface-raised text-ink"
          : "text-ink-2 hover:bg-surface-raised hover:text-ink",
      )}
      onClick={() => {
        onOpenFile(note.path);
      }}
    >
      <span className="min-w-0 flex-1 truncate">{noteTitle(note.path)}</span>
      {note.modifiedMs === undefined ? null : (
        <span className="shrink-0 text-[11px] text-ink-3">
          {relativeTimeLabel(note.modifiedMs, now)}
        </span>
      )}
    </button>
  );

  return (
    <div className="flex flex-col gap-px px-1.5">
      {pinned.length > 0 ? (
        <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-ink-3 uppercase">Pinned</p>
      ) : null}
      {pinned.map(row)}
      {groups.map((group) => (
        <div key={group.folder === "" ? "/" : group.folder} className="flex flex-col gap-px">
          {group.folder === "" ? null : (
            <p className="flex items-baseline gap-2 px-2 pt-2 pb-0.5 text-[11px] font-medium text-ink-3 uppercase">
              <span className="min-w-0 truncate">{group.folder}</span>
              <span className="shrink-0 font-normal">{group.notes.length}</span>
            </p>
          )}
          {group.notes.map(row)}
        </div>
      ))}
    </div>
  );
}
