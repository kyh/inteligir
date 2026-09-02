"use client";

// Not vendored: Beautiful UI's payload omits its GlideMenu primitive, so this one is original.

import { useCallback, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, HTMLAttributes, PointerEvent } from "react";

import { cn } from "@repo/ui/lib/utils";

interface GlideListProps extends HTMLAttributes<HTMLDivElement> {
  highlightClassName?: string;
}

interface HighlightBox {
  top: number;
  height: number;
  shown: boolean;
}

const HIDDEN: HighlightBox = { top: 0, height: 0, shown: false };

function GlideList({ className, children, highlightClassName, ...props }: GlideListProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<HighlightBox>(HIDDEN);

  const measure = useCallback((target: EventTarget | null) => {
    const host = hostRef.current;
    if (host === null || !(target instanceof Element)) return;
    const row = target.closest("[data-menu-row]");
    if (row === null || !host.contains(row)) return;
    const hostBox = host.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    setBox({ top: rowBox.top - hostBox.top, height: rowBox.height, shown: true });
  }, []);

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => measure(event.target),
    [measure],
  );
  const onFocus = useCallback(
    (event: FocusEvent<HTMLDivElement>) => measure(event.target),
    [measure],
  );
  const clear = useCallback(() => setBox(HIDDEN), []);

  const style: CSSProperties = {
    transform: `translateY(${String(box.top)}px)`,
    height: box.height,
    opacity: box.shown ? 1 : 0,
  };

  return (
    <div
      ref={hostRef}
      data-slot="glide-list"
      className={cn("relative", className)}
      onPointerMove={onPointerMove}
      onPointerLeave={clear}
      onFocus={onFocus}
      onBlur={clear}
      {...props}
    >
      <span
        aria-hidden
        data-slot="glide-list-highlight"
        className={cn(
          "pointer-events-none absolute top-0 left-0 z-0 w-full rounded-md bg-hover",
          "transition-[transform,height,opacity] duration-200 ease-out motion-reduce:transition-none",
          highlightClassName,
        )}
        style={style}
      />
      {children}
    </div>
  );
}

export { GlideList };
