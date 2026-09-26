// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.
//
// PlateContent carries the column padding itself so the block-drag gutter
// (-left-11 inside each block) sits inside the editable's padding box and
// survives its overflow-x-hidden clip. The stamped [data-editor-scroller]
// ancestor scrolls, so the container adds no overflow-y-auto.

import type { HTMLAttributes } from "react";
import { PlateContainer, PlateContent } from "platejs/react";
import type { PlateContentProps } from "platejs/react";

import { useEditorProfile } from "@repo/editor/editor-profile";
import type { EditorProfile } from "@repo/editor/editor-profile";
import { TYPESET, TYPESET_DOCS } from "@repo/editor/style-hooks";
import { cn } from "@repo/ui/lib/cn";

// select-text opts out of the shell's global user-select: none; ignore-click-outside/toolbar keeps editor clicks from closing the floating toolbar
const CONTAINER_CLASS =
  "ignore-click-outside/toolbar relative h-full w-full cursor-text select-text caret-primary selection:bg-focus-ring/25 focus-visible:outline-none [&_.slate-selection-area]:bg-focus-ring/15";

// Shared by PlateContent, the title and the raw textarea. On the desktop 48px min keeps the 44px
// drag gutter inside the clip; no fallback for the inset, which would be the measure spelled
// twice. Touch draws no drag gutter, and 28px still holds a heading's fold chevron, which hangs
// 24px left of it.
const COLUMN_PX = {
  desktop: "px-12 sm:px-[max(48px,var(--editor-column-inset))]",
  touch: "px-7",
} satisfies Record<EditorProfile, string>;

export const editorColumnPx = (profile: EditorProfile): string => COLUMN_PX[profile];

// typeset's :where() rules style the tags; element renderers carry only functional classes
const EDITOR_CLASS = cn(
  TYPESET,
  TYPESET_DOCS,
  "group/editor relative w-full overflow-x-hidden break-words whitespace-pre-wrap",
  "min-h-full pt-4 focus-visible:outline-none",
  "placeholder:text-muted-foreground/80",
  "**:data-slate-placeholder:top-[auto] **:data-slate-placeholder:text-muted-foreground/80 **:data-slate-placeholder:opacity-100!",
);

export const EditorContainer = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <PlateContainer className={cn(CONTAINER_CLASS, className)} {...props} />
);

export const Editor = ({ className, ...props }: PlateContentProps) => {
  const profile = useEditorProfile();
  return (
    <PlateContent
      className={cn(EDITOR_CLASS, editorColumnPx(profile), className)}
      disableDefaultStyles
      {...props}
    />
  );
};
