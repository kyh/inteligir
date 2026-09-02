// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.
//
// PlateContent carries the column padding itself so the block-drag gutter
// (-left-11 inside each block) sits inside the editable's padding box and
// survives its overflow-x-hidden clip. The stamped [data-editor-scroller]
// ancestor scrolls, so the container adds no overflow-y-auto.

import type { HTMLAttributes } from "react";
import { PlateContainer, PlateContent, type PlateContentProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

// select-text opts out of the shell's global user-select: none; ignore-click-outside/toolbar keeps editor clicks from closing the floating toolbar
const CONTAINER_CLASS =
  "ignore-click-outside/toolbar relative h-full w-full cursor-text select-text caret-primary selection:bg-focus-ring/25 focus-visible:outline-none [&_.slate-selection-area]:bg-focus-ring/15";

// Shared by PlateContent, the title, the raw textarea and backlinks. 48px min keeps the 44px
// drag gutter inside the clip; no fallback for the inset, which would be the measure spelled twice.
export const EDITOR_COLUMN_PX = "px-12 sm:px-[max(48px,var(--editor-column-inset))]";

// typeset's :where() rules style the tags; element renderers carry only functional classes
const EDITOR_CLASS = cn(
  "typeset typeset-docs",
  "group/editor relative w-full overflow-x-hidden break-words whitespace-pre-wrap",
  EDITOR_COLUMN_PX,
  "min-h-full pt-4 focus-visible:outline-none",
  "placeholder:text-muted-foreground/80",
  "**:data-slate-placeholder:top-[auto] **:data-slate-placeholder:text-muted-foreground/80 **:data-slate-placeholder:opacity-100!",
);

export function EditorContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <PlateContainer className={cn(CONTAINER_CLASS, className)} {...props} />;
}

export function Editor({ className, ...props }: PlateContentProps) {
  return <PlateContent className={cn(EDITOR_CLASS, className)} disableDefaultStyles {...props} />;
}
