import { useCallback, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "motion/react";
import { GripVerticalIcon, PanelLeftCloseIcon } from "lucide-react";

import { MessageThread } from "@/renderer/chat/message-thread";

type ThreadPosition = "left" | "center" | "right";

const positionStyles: Record<ThreadPosition, string> = {
  left: "left-0 top-0 bottom-0",
  center: "left-1/2 top-0 bottom-0 -translate-x-1/2",
  right: "right-0 top-0 bottom-0",
};

const dropZonePositions: Record<ThreadPosition, string> = {
  left: "left-0 top-0 bottom-0",
  center: "left-1/2 top-0 bottom-0 -translate-x-1/2",
  right: "right-0 top-0 bottom-0",
};

export function DraggableThread() {
  const [position, setPosition] = useState<ThreadPosition>("left");
  const [visible, setVisible] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [hoverZone, setHoverZone] = useState<ThreadPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Subtle shadow scaling with drag distance
  const dragDistance = useTransform(() => Math.abs(x.get()) + Math.abs(y.get()));
  const boxShadow = useTransform(
    dragDistance,
    [0, 100],
    ["0 0 0 0 rgba(0,0,0,0)", "0 8px 32px 0 rgba(0,0,0,0.2)"],
  );

  const getSnapZone = useCallback(
    (pointerX: number): ThreadPosition => {
      const container = containerRef.current?.parentElement;
      if (!container) return position;
      const { width } = container.getBoundingClientRect();
      const third = width / 3;
      if (pointerX < third) return "left";
      if (pointerX > third * 2) return "right";
      return "center";
    },
    [position],
  );

  const handleDrag = useCallback(
    (_: unknown, info: { point: { x: number } }) => {
      const container = containerRef.current?.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const relativeX = info.point.x - rect.left;
      setHoverZone(getSnapZone(relativeX));
    },
    [getSnapZone],
  );

  const handleDragStart = useCallback(() => {
    setDragging(true);
  }, []);

  const handleDragEnd = useCallback(
    (_: unknown, info: { point: { x: number } }) => {
      const container = containerRef.current?.parentElement;
      if (!container) {
        setDragging(false);
        setHoverZone(null);
        return;
      }
      const rect = container.getBoundingClientRect();
      const relativeX = info.point.x - rect.left;
      const newPosition = getSnapZone(relativeX);
      setPosition(newPosition);
      setDragging(false);
      setHoverZone(null);
      void animate(x, 0, { type: "spring", stiffness: 500, damping: 30 });
      void animate(y, 0, { type: "spring", stiffness: 500, damping: 30 });
    },
    [getSnapZone, x, y],
  );

  if (!visible) {
    return (
      <button
        type="button"
        onClick={() => setVisible(true)}
        className="absolute left-2 top-2 z-20 rounded-md bg-background/80 p-1.5 text-muted-foreground shadow-sm backdrop-blur-sm transition hover:text-foreground"
        title="Show messages"
      >
        <GripVerticalIcon className="size-3.5" />
      </button>
    );
  }

  return (
    <>
      {/* Drop zone indicators — visible while dragging */}
      {dragging &&
        (["left", "center", "right"] as const).map((zone) => (
          <div
            key={zone}
            className={`pointer-events-none absolute z-10 w-72 ${dropZonePositions[zone]}`}
          >
            <div
              className={`mx-2 h-full rounded-lg border-2 border-dashed transition-colors ${
                hoverZone === zone
                  ? "border-foreground/30 bg-foreground/5"
                  : "border-border/40"
              }`}
            />
          </div>
        ))}

      {/* Draggable thread panel */}
      <motion.div
        ref={containerRef}
        className={`absolute z-20 h-full w-72 ${positionStyles[position]}`}
        style={{ x, y, boxShadow }}
        layout
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        <div className="flex h-full flex-col bg-background/60 backdrop-blur-sm">
          {/* Header with drag handle + hide button */}
          <div className="flex shrink-0 items-center gap-1 px-2 py-2">
            <motion.button
              type="button"
              drag
              dragMomentum={false}
              dragElastic={0.1}
              onDragStart={handleDragStart}
              onDrag={handleDrag}
              onDragEnd={handleDragEnd}
              style={{ x, y }}
              className="cursor-grab rounded p-1 text-muted-foreground transition hover:text-foreground active:cursor-grabbing"
              title="Drag to reposition"
            >
              <GripVerticalIcon className="size-3.5" />
            </motion.button>
            <button
              type="button"
              onClick={() => setVisible(false)}
              className="rounded p-1 text-muted-foreground transition hover:text-foreground"
              title="Hide messages"
            >
              <PanelLeftCloseIcon className="size-3.5" />
            </button>
            <span className="ml-1 text-xs font-medium text-muted-foreground">
              Messages
            </span>
          </div>

          <MessageThread />
        </div>
      </motion.div>
    </>
  );
}
