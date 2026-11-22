import type { OpenNote } from "@repo/editor/item/item-editor";
import { cn } from "@repo/ui/lib/cn";
import { useRef } from "react";

import { ItemView } from "../item/item-view";
import { LIST_MAX_WIDTH, LIST_MIN_WIDTH, usePref, windowLayout } from "../prefs";
import { ListView } from "./list-view";
import type { ListViewProps } from "./list-view";

const KEY_STEP_PX = 16;

const clamped = (px: number) => Math.min(LIST_MAX_WIDTH, Math.max(LIST_MIN_WIDTH, Math.round(px)));

export const ListSplit = ({
  onNote,
  ...list
}: ListViewProps & { readonly onNote: (note: OpenNote | null) => void }) => {
  const [width, setWidth] = usePref(windowLayout, "listWidth");
  const dragFrom = useRef<{ readonly x: number; readonly width: number } | null>(null);
  const { openItem } = list;

  if (openItem === null) {
    return <ListView {...list} />;
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="h-full min-h-0 shrink-0" style={{ width: `${String(width)}px` }}>
        <ListView {...list} />
      </div>
      <button
        type="button"
        aria-label="Resize the list"
        className={cn(
          "relative w-px shrink-0 cursor-col-resize bg-border outline-none",
          "before:absolute before:inset-y-0 before:-right-1.5 before:-left-1.5 before:content-['']",
          "focus-visible:bg-ring hover:bg-ring/60",
        )}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragFrom.current = { width, x: event.clientX };
        }}
        onPointerMove={(event) => {
          const from = dragFrom.current;

          if (from !== null) {
            setWidth(clamped(from.width + event.clientX - from.x));
          }
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          dragFrom.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setWidth(clamped(width + (event.key === "ArrowLeft" ? -KEY_STEP_PX : KEY_STEP_PX)));
          }
        }}
      />
      <div className="h-full min-h-0 min-w-0 flex-1">
        <ItemView itemId={openItem} onNote={onNote} />
      </div>
    </div>
  );
};
