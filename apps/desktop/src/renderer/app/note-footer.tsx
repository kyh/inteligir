import { useNoteStats } from "@repo/editor/note-stats";
import { plural } from "@repo/ui/lib/plural";
import { readingTimeLabel } from "./actions/note-facts";

// The strip under the open note: its count alone, since the workspace's state lives in the
// rail's footer. No rule above it, so it reads as the note's last line. The count is what the
// serializer published, never a recount.
export const NoteFooter = ({ path }: { path: string | null }) => {
  const stats = useNoteStats(path);
  return (
    <footer className="flex h-[var(--app-status-h)] shrink-0 items-center justify-end px-3 text-xs text-muted-foreground tabular-nums print:hidden">
      {stats === null ? null : (
        <span>
          {plural(stats.words, "word")} · {readingTimeLabel(stats.words)}
        </span>
      )}
    </footer>
  );
};
