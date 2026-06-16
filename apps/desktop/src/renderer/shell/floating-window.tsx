import { useEffect, useRef, useState } from "react";
import { PinIcon, XIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";
import { Button } from "@repo/ui/components/button";
import type { FloatRect } from "@/shared/shell";

const MIN_W = 240;
const MIN_H = 160;
// Keep at least this many pixels of the window on screen on every edge, so a
// drag can't strand a panel off-screen with no way to grab it back. The y
// floor of 0 also keeps the title bar (the drag handle) reachable.
const KEEP_VISIBLE = 80;

function clampMovePosition(x: number, y: number, width: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, KEEP_VISIBLE - width), window.innerWidth - KEEP_VISIBLE),
    y: Math.min(Math.max(y, 0), Math.max(0, window.innerHeight - KEEP_VISIBLE)),
  };
}

type Drag =
  | { mode: "move"; px: number; py: number; rect: FloatRect }
  | { mode: "resize"; px: number; py: number; rect: FloatRect };

/**
 * A free-floating, draggable + resizable window (an "app window"). Position is
 * tracked locally during a drag for smoothness and persisted (via onRect) on
 * release; props.rect re-syncs it when no drag is in flight.
 */
export function FloatingWindow({
  icon: Icon,
  title,
  rect,
  z,
  bodyClassName,
  onRect,
  onClose,
  onDock,
  onFocus,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  rect: FloatRect;
  z: number;
  bodyClassName?: string | undefined;
  onRect: (rect: FloatRect) => void;
  onClose?: () => void;
  onDock: () => void;
  onFocus: () => void;
  children: React.ReactNode;
}) {
  const [local, setLocal] = useState(rect);
  const dragRef = useRef<Drag | null>(null);
  // Keep the latest onRect without re-subscribing the window listeners every
  // render (the parent passes a fresh closure each time).
  const onRectRef = useRef(onRect);
  onRectRef.current = onRect;

  useEffect(() => {
    if (!dragRef.current) setLocal(rect);
  }, [rect]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.px;
      const dy = e.clientY - drag.py;
      if (drag.mode === "move") {
        const { x, y } = clampMovePosition(drag.rect.x + dx, drag.rect.y + dy, drag.rect.width);
        setLocal({ ...drag.rect, x, y });
      } else {
        setLocal({
          ...drag.rect,
          width: Math.max(MIN_W, drag.rect.width + dx),
          height: Math.max(MIN_H, drag.rect.height + dy),
        });
      }
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setLocal((r) => {
        onRectRef.current(r);
        return r;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // The root onPointerDown handles focus (it bubbles), so startMove doesn't
  // also call it. startResize stops propagation, so it focuses itself.
  const startMove = (e: React.PointerEvent) => {
    dragRef.current = { mode: "move", px: e.clientX, py: e.clientY, rect: local };
  };
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    onFocus();
    dragRef.current = { mode: "resize", px: e.clientX, py: e.clientY, rect: local };
  };

  // The positioned root carries geometry/focus only; the card itself is an
  // inner div so the window actions can float OUTSIDE the card edge as a
  // stack of circular glass pucks (reference language) without being clipped
  // by the card's overflow-hidden rounding.
  return (
    <div
      className="pointer-events-auto absolute"
      style={{
        left: local.x,
        top: local.y,
        width: local.width,
        height: local.height,
        zIndex: 10 + z,
      }}
      onPointerDown={onFocus}
    >
      <div className="object-pane flex h-full w-full flex-col overflow-hidden rounded-[var(--radius-window)] border">
        <div
          className="flex h-7 shrink-0 cursor-move items-center gap-1.5 px-2.5"
          onPointerDown={startMove}
        >
          <Icon className="size-3.5 shrink-0 text-[rgba(19,20,27,0.34)]" />
          <span className="truncate text-[13px] leading-4 font-normal text-[rgba(19,20,27,0.44)]">
            {title}
          </span>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
      </div>
      {/* Stacked circular glass action pucks beside the card's top-right edge. */}
      <div className="absolute top-0 -right-11 flex flex-col gap-2">
        <Button variant="glass" size="icon" aria-label="Pin to desktop" onClick={onDock}>
          <PinIcon className="size-4" />
        </Button>
        {onClose ? (
          <Button variant="glass" size="icon" aria-label="Close window" onClick={onClose}>
            <XIcon className="size-4" />
          </Button>
        ) : null}
      </div>
      <div
        className="absolute bottom-0 right-0 size-3 cursor-se-resize"
        onPointerDown={startResize}
      />
    </div>
  );
}
