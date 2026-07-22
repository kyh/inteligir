import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";

import { useAiReviewStore } from "@renderer/stores/ai-review-store";
import { useOpenNote } from "@renderer/workspace/open-note-store";

/**
 * Save status as a quiet dot pinned to the content column's bottom-right:
 * green = saved, grey = anything pending (saving, unsaved edits, or autosave
 * frozen while AI suggestions await review). The words live in the tooltip.
 */
export function SaveIndicator() {
  { const w = window as unknown as { __rc?: Record<string, number> }; const rc = (w.__rc ??= {}); rc["saveIndicator"] = (rc["saveIndicator"] ?? 0) + 1; document.title = JSON.stringify(rc); }
  const path = useOpenNote((s) => s.editor.path);
  const saving = useOpenNote((s) => s.editor.saving);
  const dirty = useOpenNote((s) => s.editor.dirty);
  // While an AI suggestion session pends ON THIS note, its autosave is frozen
  // (the transient gate) — say so instead of silently reading "Saved" over
  // stale bytes.
  const reviewingPaths = useAiReviewStore((s) => s.reviewing);
  const reviewing = path !== null && reviewingPaths.has(path);

  if (path === null) return null;

  const saved = !reviewing && !saving && !dirty;
  const label = reviewing
    ? "Saving is paused while AI suggestions await review — resolve or leave to settle them"
    : saving
      ? "Saving…"
      : dirty
        ? "Unsaved"
        : "Saved";

  return (
    <div className="absolute right-3 bottom-3 z-30">
      <Tooltip>
        <TooltipTrigger
          aria-label={label}
          className="flex size-5 items-center justify-center rounded-2xl"
        >
          <span
            className={cn(
              "size-2 rounded-full transition-colors",
              saved ? "bg-emerald-500" : "bg-muted-foreground/50",
            )}
          />
        </TooltipTrigger>
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
    </div>
  );
}
