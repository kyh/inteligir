// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.
// Editor chrome: plate's registry editor.tsx container/content pair reduced
// to its `default` variant (no comment/ai/select/demo/fullWidth variants, so
// the cva wrappers collapse to plain class strings) and mapped onto this
// app's design tokens (upstream's `brand` → `primary`).
//
// Column geometry follows upstream's default variant: PlateContent itself carries the centered
// ~700px column padding (EDITOR_COLUMN_PX) so the block-drag hover gutter —
// absolutely positioned at -left-11 inside each block — lands INSIDE the
// editable's padding box and survives its overflow-x-hidden clip. The
// filename-title <h1>, the Raw textarea, and the backlinks section apply the
// same constant so all four surfaces share byte-exact column geometry (the
// pane wrapper owns only the vertical padding). The workspace <main> is the
// scroll container (toc.tsx depends on that), so the container deliberately
// adds no overflow-y-auto.

import type { HTMLAttributes } from "react";
import { PlateContainer, PlateContent, type PlateContentProps } from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

// `select-text` opts back out of the app shell's global user-select: none;
// `ignore-click-outside/toolbar` keeps clicks inside the editor from closing
// the floating toolbar (@platejs/floating's clickOutside ignore class).
const CONTAINER_CLASS =
  "ignore-click-outside/toolbar relative h-full w-full cursor-text select-text caret-primary selection:bg-focus-ring/25 focus-visible:outline-none [&_.slate-selection-area]:bg-focus-ring/15";

/** The centered text column (symmetric padding, not max-w). Shared by
 * PlateContent, the page-title <h1>, the Raw textarea, and the backlinks
 * section so they can't drift apart. 48px min padding keeps the -left-11
 * (44px) drag gutter inside the editable's clip with a 4px reveal. The inset
 * is the workspace's `--editor-column-inset` (Settings → Appearance picks
 * between the reading column and the full pane); its default keeps the ~700px
 * column. */
export const EDITOR_COLUMN_PX =
  "px-12 sm:px-[max(48px,var(--editor-column-inset,calc(50%-350px)))]";

// Document typography comes from shadcn/typeset (typeset.css + the
// .typeset-docs preset in @repo/ui globals) — element renderers carry only
// functional classes; typeset's :where() rules style the tags.
const EDITOR_CLASS = cn(
  "typeset typeset-docs",
  "group/editor relative w-full overflow-x-hidden break-words whitespace-pre-wrap",
  EDITOR_COLUMN_PX,
  "min-h-full pt-4 focus-visible:outline-none",
  "placeholder:text-muted-foreground/80",
  "**:data-slate-placeholder:top-[auto] **:data-slate-placeholder:text-muted-foreground/80 **:data-slate-placeholder:opacity-100!",
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
