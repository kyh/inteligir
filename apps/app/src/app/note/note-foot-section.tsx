// The chrome the sections under a document are drawn out of: the collapsible
// with its chevron and its summary line, the list, the row a click opens, and
// the sentence that stands in for a list there is none of.
//
// Its own module because there are two of these sections — backlinks and
// related — and they are deliberately alike. They sit in the same measure at
// the foot of the same column, so a reader should not be able to tell that two
// files draw them; drawn twice, they diverge on the first padding tweak.
//
// What a section still owns is everything it CLAIMS: its summary line, the
// sentence it shows when it has nothing to list, and whether it starts open —
// backlinks open because they are counted, related closed because they are
// inferred.

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible";
import { cn } from "@repo/ui/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

export interface NoteFootSectionProps {
  /** The trigger's whole line — a count once the read has settled, the
   *  section's plain name while it has not, because a count is a claim. */
  summary: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function NoteFootSection({ summary, open, onOpenChange, children }: NoteFootSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-2 text-xs font-medium tracking-wide text-muted-foreground hover:text-foreground">
        <ChevronRightIcon
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        {summary}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** What a section says instead of a list: still loading, refused, or nothing
 *  to show. Three different sentences, one shape — the reader is told which. */
export function NoteFootMessage({ children }: { children: React.ReactNode }) {
  return <p className="pb-4 text-sm text-muted-foreground">{children}</p>;
}

export function NoteFootList({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-1 pb-4">{children}</ul>;
}

export interface NoteFootRowProps {
  /** The line a reader reads — a note's own name, never its path. */
  label: string;
  /** The path, carried as the label's hover title: neither section spends a
   *  line on one, and a vault holds two notes with the same name. */
  path: string;
  /** Why this row is here — the sentence that links, the reasons it ranked.
   *  Not optional: a backlink without its snippet is a bare filename, and an
   *  inferred row without its reasons is a ranking nobody can check. */
  detail: string;
  onOpen: () => void;
}

export function NoteFootRow({ label, path, detail, onOpen }: NoteFootRowProps) {
  return (
    <li>
      <button
        type="button"
        className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
        onClick={onOpen}
      >
        <span className="block truncate text-sm" title={path}>
          {label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </button>
    </li>
  );
}

/**
 * A section's openness, bound to the pref that outlives the note. The write
 * rides the same call as the state change because the two ARE one act — split
 * across a handler and an effect, a section that never re-renders forgets.
 */
export function useSectionOpen(
  read: () => boolean,
  write: (open: boolean) => void,
): readonly [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(read);
  return [
    open,
    (next: boolean): void => {
      write(next);
      setOpen(next);
    },
  ];
}
