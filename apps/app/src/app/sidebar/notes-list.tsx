// The sidebar's default view (Moss's IA): notes ordered by recency with
// relative timestamps — what you touched last is where you left off. The
// file TREE stays one toggle away for anyone who thinks in folders; this
// list answers "what was I working on", not "where does it live".

import type { VaultTreeResponse } from "@repo/server-contract/vault";
import { cn } from "@repo/ui/lib/utils";

type FileEntry = Extract<VaultTreeResponse["entries"][number], { kind: "file" }>;

/** "Just now" → minutes → hours → days → a date. One vocabulary, sidebar-wide. */
export function relativeTimeLabel(modifiedMs: number, now: number): string {
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

export interface NotesListProps {
  entries: VaultTreeResponse["entries"];
  openPath: string | null;
  onOpenFile: (path: string) => void;
}

export function NotesList({ entries, openPath, onOpenFile }: NotesListProps) {
  const now = Date.now();
  const notes = entries
    .filter((entry): entry is FileEntry => entry.kind === "file" && entry.path.endsWith(".md"))
    .toSorted((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));

  if (notes.length === 0) {
    return <p className="px-3 py-2 text-sm text-ink-3">No notes yet.</p>;
  }

  return (
    <div className="flex flex-col gap-px px-1.5">
      {notes.map((note) => (
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
      ))}
    </div>
  );
}
