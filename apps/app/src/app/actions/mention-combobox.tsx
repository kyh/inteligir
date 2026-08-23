// The composer's @-mention picker: a small
// combobox over the vault's notes, fed by the knowledge wiki-targets the
// `[[` picker already answers from. Pure helpers own the two decisions —
// where an @-mention IS (word-boundary `@`, no whitespace before the caret)
// and which targets a query lists — so the composer only wires keys to
// state. Picking is the CALLER's move: it splices the text and keeps the
// chosen paths as chips.

import type { WikiTargetWire } from "@repo/server-contract/knowledge";
import { cn } from "@repo/ui/lib/utils";
import { FileTextIcon } from "lucide-react";

/** How many rows a query lists — a picker, not a browser. */
export const MENTION_MAX_ROWS = 8;

export interface MentionSpan {
  /** Offset of the `@` itself; a pick replaces `[start, caret)`. */
  start: number;
  /** What was typed after the `@`, up to the caret. */
  query: string;
}

/**
 * The mention the caret sits in, or null. The `@` must begin a word (start
 * of text or after whitespace) so an email address or a mid-word `@` never
 * opens the picker, and the query runs `@`→caret with no whitespace — a
 * space ends the mention.
 */
export function activeMentionAt(text: string, caret: number): MentionSpan | null {
  const start = text.lastIndexOf("@", caret - 1);
  if (start === -1) return null;
  if (start > 0 && !/\s/u.test(text.charAt(start - 1))) return null;
  const query = text.slice(start + 1, caret);
  if (/\s/u.test(query)) return null;
  return { start, query };
}

/**
 * Docs matching the query (case-insensitive, path OR title OR alias),
 * minus paths already attached — a chip that exists is not offered twice.
 */
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

/** Renders above the composer field; the field keeps focus and the keys. */
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
          // mousedown, not click: a click would blur the textarea first and
          // tear the mention span out from under the pick.
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
