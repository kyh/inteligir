import { useEffect, useRef, useState } from "react";
import { PinIcon, XIcon } from "lucide-react";

import { cn } from "@repo/ui/lib/utils";
import { ChromeButton } from "@/renderer/shell/widget-render";
import type { FloatRect } from "@/shared/shell";

const MIN_W = 240;
const MIN_H = 160;

type Drag =
  | { mode: "move"; px: number; py: number; rect: FloatRect }
  | { mode: "resize"; px: number; py: number; rect: FloatRect };

/**
 * A free-floating, draggable + resizable window (an "app window"). Position is
 * tracked locally during a drag for smoothness and persisted (via onRect) on
 * release; props.rect re-syncs it when no drag is in flight.
 */
export function FloatingWindow({
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
  title: React.ReactNode;
  rect: FloatRect;
  z: number;
  bodyClassName?: string;
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
        setLocal({ ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy });
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

  return (
    <div
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-2xl backdrop-blur-md"
      style={{ left: local.x, top: local.y, width: local.width, height: local.height, zIndex: 10 + z }}
      onPointerDown={onFocus}
    >
      <div
        className="flex shrink-0 cursor-move items-center justify-between gap-2 border-b border-border/60 px-3 py-2"
        onPointerDown={startMove}
      >
        <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <ChromeButton label="Pin to desktop" onClick={onDock}>
            <PinIcon className="size-3.5" />
          </ChromeButton>
          {onClose ? (
            <ChromeButton label="Close window" onClick={onClose}>
              <XIcon className="size-3.5" />
            </ChromeButton>
          ) : null}
        </div>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
      <div
        className="absolute bottom-0 right-0 size-3 cursor-se-resize"
        onPointerDown={startResize}
      />
    </div>
  );
}
