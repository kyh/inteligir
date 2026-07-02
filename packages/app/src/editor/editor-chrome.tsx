/* Adapted from Plate Plus Potion (https://pro.platejs.org) — used under the
 * held Plate Plus license. */
// Editor chrome: potion's editor.tsx container/content pair reduced to its
// `default` variant (comment/ai/select/demo/fullWidth/… variants deleted, so
// the cva wrappers collapse to plain class strings) and mapped onto fluid
// tokens (brand → primary; the token table lives in the Phase E spec §4.3).
//
// Column geometry differs from potion by design: the pane wrapper
// (editor-pane.tsx) owns the centered ~700px column, the horizontal padding
// AND the pb-72 breathing room, because the filename-title <h1> and the Raw
// textarea must share the exact column with the rich body — PlateContent gets
// neither. The workspace <main> is the scroll container (toc.tsx depends on
// that), so the container deliberately adds no overflow-y-auto.

import type { HTMLAttributes } from "react";
import { PlateContainer, PlateContent, type PlateContentProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

// `select-text` opts back out of the app shell's global user-select: none;
// `ignore-click-outside/toolbar` keeps clicks inside the editor from closing
// the floating toolbar (@platejs/floating's clickOutside ignore class).
const CONTAINER_CLASS =
  "ignore-click-outside/toolbar relative h-full w-full cursor-text select-text caret-primary selection:bg-primary/20 focus-visible:outline-none [&_.slate-selection-area]:bg-primary/15";

const EDITOR_CLASS = cn(
  "group/editor potion-editor-typography relative w-full overflow-x-hidden break-words whitespace-pre-wrap",
  "min-h-full pt-4 text-base focus-visible:outline-none",
  "placeholder:text-muted-foreground/60",
  "**:data-slate-placeholder:top-[auto] **:data-slate-placeholder:text-muted-foreground/60 **:data-slate-placeholder:opacity-100!",
  "[&_strong]:font-semibold",
);

/** Positioning + selection context for the editor: the floating toolbar and
 * the cursor overlay (afterEditable renders) position against this wrapper. */
export function EditorContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <PlateContainer className={cn(CONTAINER_CLASS, className)} {...props} />;
}

/** The editable surface. Chrome only — padding/column live on the pane. */
export function Editor({ className, ...props }: PlateContentProps) {
  return <PlateContent className={cn(EDITOR_CLASS, className)} disableDefaultStyles {...props} />;
}
