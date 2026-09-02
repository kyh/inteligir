import type { WikiTargetWire } from "@repo/api/local/knowledge/knowledge-schema";
import { cn } from "@repo/ui/lib/utils";
import { FileTextIcon } from "lucide-react";

export const MENTION_MAX_ROWS = 8;

export interface MentionSpan {
  start: number;
  query: string;
}

// the `@` must begin a word so an email address never opens the picker.
export function activeMentionAt(text: string, caret: number): MentionSpan | null {
  const start = text.lastIndexOf("@", caret - 1);
  if (start === -1) return null;
  if (start > 0 && !/\s/u.test(text.charAt(start - 1))) return null;
  const query = text.slice(start + 1, caret);
  if (/\s/u.test(query)) return null;
  return { start, query };
}

export function filterMentionTargets(
  targets: readonly WikiTargetWire[],
  query: string,
  attached: ReadonlySet<string>,
): WikiTargetWire[] {
  const needle = query.toLowerCase();
  return targets
    .filter((target) => target.type === "doc" && !attached.has(target.path))
    .filter(
      (target) =>
        needle === "" ||
        target.path.toLowerCase().includes(needle) ||
        target.title.toLowerCase().includes(needle) ||
        (target.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle)),
    )
    .slice(0, MENTION_MAX_ROWS);
}

export interface MentionComboboxProps {
  options: readonly WikiTargetWire[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (target: WikiTargetWire) => void;
}

export function MentionCombobox({ options, activeIndex, onHover, onPick }: MentionComboboxProps) {
  if (options.length === 0) {
    return null;
  }
  return (
    <div
      role="listbox"
      aria-label="Mention a note"
      className="absolute inset-x-0 bottom-full z-10 mb-1 overflow-hidden rounded-lg border border-line bg-surface-raised py-1 shadow-surface-2"
    >
      {options.map((option, index) => (
        <button
          key={option.path}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={cn(
            "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm",
            index === activeIndex ? "bg-surface text-ink" : "text-ink-2",
          )}
          onMouseEnter={() => {
            onHover(index);
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(option);
          }}
        >
          <FileTextIcon className="size-3.5 shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate">{option.title}</span>
          <span className="max-w-[45%] shrink-0 truncate text-[11px] text-ink-3">
            {option.path}
          </span>
        </button>
      ))}
    </div>
  );
}
