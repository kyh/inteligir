import { useMemo } from "react";
import { LockIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";

import { describeGateReason } from "@repo/editor/markdown/markdown-doc";
import { useAiReviewStore } from "@repo/editor/stores/ai-review-store";
import { useOpenNote } from "@repo/editor/note/open-note-store";
import { documentStats, type DocumentStats } from "@repo/workspace/workspace/document-stats";
import { parseStoredStringArray, useDiskState } from "@repo/workspace/lib/use-disk-state";

/** One row per metric, in display order. `key` is what persists. */
const METRICS: readonly { key: string; label: string; read: (s: DocumentStats) => number }[] = [
  { key: "words", label: "words", read: (s) => s.words },
  { key: "characters", label: "characters", read: (s) => s.characters },
  { key: "paragraphs", label: "paragraphs", read: (s) => s.paragraphs },
];

const METRICS_KEY = "workspace.statusMetrics";
const DEFAULT_METRICS = ["words"];

/**
 * The one place the open note reports on ITSELF: what the file is (private,
 * Raw), whether it is saved, and how much of it there is. Everything here is
 * status — nothing acts on the note, which is what keeps it out of the header.
 *
 * It is the app's SECOND live-content subscriber (the editor is the first), by
 * necessity: a word count that lags the buffer is a word count nobody trusts.
 * The counting is memoized on the buffer and this row has no children, so a
 * keystroke re-renders one flex row.
 */
export function StatusBar() {
  const path = useOpenNote((s) => s.editor.path);
  const content = useOpenNote((s) => s.editor.content);
  const isPrivate = useOpenNote((s) => s.openDoc.kind === "markdown" && s.openDoc.isPrivate);
  const rawReason = useOpenNote((s) =>
    s.openDoc.kind === "markdown" && s.openDoc.surface.mode === "raw"
      ? s.openDoc.surface.reason
      : null,
  );

  const [enabled, setEnabled] = useDiskState(METRICS_KEY, DEFAULT_METRICS, parseStoredStringArray);
  const stats = useMemo(() => documentStats(content), [content]);

  if (path === null) return null;

  const toggle = (key: string) =>
    setEnabled(enabled.includes(key) ? enabled.filter((k) => k !== key) : [...enabled, key]);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 px-4 text-[11px] text-muted-foreground">
      <SaveDot path={path} />
      {isPrivate && (
        <Tooltip>
          <TooltipTrigger className="flex items-center gap-1">
            <LockIcon className="size-3" />
            Private
          </TooltipTrigger>
          <TooltipContent side="top">
            The editor&apos;s AI, ghost text and read-aloud skip this note. The agent can still read
            it.
          </TooltipContent>
        </Tooltip>
      )}
      {rawReason !== null && (
        <Tooltip>
          <TooltipTrigger>Raw</TooltipTrigger>
          <TooltipContent side="top">{describeGateReason(rawReason)}</TooltipContent>
        </Tooltip>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Choose which counts to show"
          className="ml-auto flex items-center gap-3 rounded px-1 py-0.5 tabular-nums hover:text-foreground"
        >
          {METRICS.filter((metric) => enabled.includes(metric.key)).map((metric) => (
            <span key={metric.key}>
              {metric.read(stats).toLocaleString()} {metric.label}
            </span>
          ))}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuLabel>Show</DropdownMenuLabel>
          {METRICS.map((metric) => (
            <DropdownMenuCheckboxItem
              key={metric.key}
              checked={enabled.includes(metric.key)}
              onClick={() => toggle(metric.key)}
              className="capitalize"
            >
              {metric.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </footer>
  );
}

/** Save status as a quiet dot: green = saved, grey = anything pending (saving,
 * unsaved edits, or autosave frozen while AI suggestions await review). The
 * words live in the tooltip. */
function SaveDot({ path }: { path: string }) {
  const saving = useOpenNote((s) => s.editor.saving);
  const dirty = useOpenNote((s) => s.editor.dirty);
  // While an AI suggestion session pends ON THIS note, its autosave is frozen
  // (the transient gate) — say so instead of silently reading "Saved" over
  // stale bytes.
  const reviewing = useAiReviewStore((s) => s.reviewing.has(path));

  const saved = !reviewing && !saving && !dirty;
  const label = reviewing
    ? "Saving is paused while AI suggestions await review — resolve or leave to settle them"
    : saving
      ? "Saving…"
      : dirty
        ? "Unsaved"
        : "Saved";

  return (
    <Tooltip>
      <TooltipTrigger aria-label={label} className="flex items-center">
        <span
          className={cn(
            "size-1.5 rounded-full transition-colors",
            saved ? "bg-emerald-500" : "bg-muted-foreground/50",
          )}
        />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
