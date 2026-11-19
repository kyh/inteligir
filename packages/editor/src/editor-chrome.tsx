// @license MIT, vendored from plate (github.com/udecode/plate). © Plate contributors.

import type { HTMLAttributes } from "react";
import type { RenderChunkFn } from "platejs";
import { PlateContainer, PlateContent } from "platejs/react";
import type { PlateContentProps } from "platejs/react";

import { useEditorProfile } from "@repo/editor/editor-profile";
import type { EditorProfile } from "@repo/editor/editor-profile";
import { anchorRun } from "@repo/editor/run-anchoring";
import { EDITOR_CHUNK, TYPESET, TYPESET_DOCS } from "@repo/editor/style-hooks";
import { cn } from "@repo/ui/lib/cn";

const CONTAINER_CLASS =
  "ignore-click-outside/toolbar relative h-full w-full cursor-text select-text caret-primary selection:bg-focus-ring/25 focus-visible:outline-none [&_.slate-selection-area]:bg-focus-ring/15";

const COLUMN_PX = {
  desktop: "px-12 sm:px-[max(48px,var(--editor-column-inset))]",
  touch: "px-7",
} satisfies Record<EditorProfile, string>;

export const editorColumnPx = (profile: EditorProfile) => COLUMN_PX[profile];

const EDITOR_CLASS = cn(
  TYPESET,
  TYPESET_DOCS,
  "group/editor relative w-full overflow-x-hidden break-words whitespace-pre-wrap",
  "min-h-full pt-4 focus-visible:outline-none",
  "placeholder:text-muted-foreground/80",
  "**:data-slate-placeholder:top-[auto] **:data-slate-placeholder:text-muted-foreground/80 **:data-slate-placeholder:opacity-100!",
);

const EditorChunk: RenderChunkFn = ({ attributes, children, lowest }) =>
  // oxlint-disable-next-line typescript/no-unsafe-return -- Plate types a chunk's children `any`; a run of runs draws them as given
  lowest ? (
    <div {...attributes} ref={anchorRun} className={EDITOR_CHUNK}>
      {children}
    </div>
  ) : (
    children
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
      renderChunk={EditorChunk}
      {...props}
    />
  );
};
