"use client";
// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).

import { useEffect, useId, useRef, useState } from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { animate, motion, useMotionValue } from "motion/react";

import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";
import { spring } from "@repo/ui/lib/springs";
import { cn } from "@repo/ui/lib/cn";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

const m = {
  pillExtend: 2,
  pressExtend: 3,
  pressShrink: 3,
  thumbSize: 12,
  trackHeight: 16,
  trackWidth: 28,
} as const;

const THUMB_OFFSET = 2;
const DRAG_DEAD_ZONE = 2;

interface DragAsk {
  readonly on: boolean;
}

const Switch = ({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  "aria-label": ariaLabel,
}: SwitchProps) => {
  const labelId = useId();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const thumbTravel = m.trackWidth - m.thumbSize - THUMB_OFFSET * 2;

  const dragging = useRef(false);
  const didDrag = useRef(false);

  const pointerStart = useRef<{
    clientX: number;
    originX: number;
  } | null>(null);

  const motionX = useMotionValue(checked ? THUMB_OFFSET + thumbTravel : THUMB_OFFSET);
  const [asked, setAsked] = useState<DragAsk | null>(null);
  const awaitingAnswer = asked !== null && asked.on !== checked;

  const checkedBackground = hovered
    ? "color-mix(in oklab, var(--primary), rgb(var(--overlay)) 12%)"
    : "var(--primary)";

  const uncheckedBackground = hovered
    ? "color-mix(in oklab, var(--accent), rgb(var(--overlay)) 10%)"
    : "var(--accent)";

  const trackBackground = checked ? checkedBackground : uncheckedBackground;
  const restingWidth = hovered ? m.thumbSize + m.pillExtend : m.thumbSize;
  const thumbWidth = pressed ? m.thumbSize + m.pressExtend : restingWidth;
  const thumbHeight = pressed ? m.thumbSize - m.pressShrink : m.thumbSize;
  const thumbY = pressed ? THUMB_OFFSET + m.pressShrink / 2 : THUMB_OFFSET;
  const extraWidth = thumbWidth - m.thumbSize;
  const thumbX = checked ? THUMB_OFFSET + thumbTravel - extraWidth : THUMB_OFFSET;

  useEffect(() => {
    if (dragging.current || awaitingAnswer) {
      return;
    }

    animate(motionX, thumbX, spring.moderate);
  }, [thumbX, motionX, awaitingAnswer]);

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (disabled) {
      return;
    }

    if (e.pointerType === "mouse" && e.button !== 0) {
      return;
    }

    setPressed(true);
    dragging.current = false;
    didDrag.current = false;
    pointerStart.current = {
      clientX: e.clientX,
      originX: motionX.get(),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!pointerStart.current) {
      return;
    }

    const delta = e.clientX - pointerStart.current.clientX;

    if (!dragging.current) {
      if (Math.abs(delta) < DRAG_DEAD_ZONE) {
        return;
      }

      dragging.current = true;
      motionX.stop();
    }

    const dragMin = THUMB_OFFSET;
    const pressedThumbWidth = m.thumbSize + m.pressExtend;
    const dragMax = m.trackWidth - THUMB_OFFSET - pressedThumbWidth;
    const rawX = pointerStart.current.originX + delta;
    motionX.set(Math.max(dragMin, Math.min(dragMax, rawX)));
  };

  const handlePointerUp = () => {
    if (!pointerStart.current) {
      return;
    }

    setPressed(false);

    if (dragging.current) {
      didDrag.current = true;
      dragging.current = false;

      const currentX = motionX.get();
      const dragMin = THUMB_OFFSET;
      const pressedThumbWidth = m.thumbSize + m.pressExtend;
      const dragMax = m.trackWidth - THUMB_OFFSET - pressedThumbWidth;
      const midpoint = (dragMin + dragMax) / 2;

      const shouldBeOn = currentX > midpoint;

      if (shouldBeOn === checked) {
        const snapTarget = checked ? THUMB_OFFSET + thumbTravel : THUMB_OFFSET;
        animate(motionX, snapTarget, spring.moderate);
      } else {
        const ask: DragAsk = { on: shouldBeOn };
        setAsked(ask);
        onCheckedChange(shouldBeOn);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setAsked((current) => (current === ask ? null : current));
          });
        });
      }

      requestAnimationFrame(() => {
        didDrag.current = false;
      });
    }

    pointerStart.current = null;
  };

  const handlePointerCancel = () => {
    if (!pointerStart.current) {
      return;
    }

    setPressed(false);

    if (dragging.current) {
      dragging.current = false;
      const snapTarget = checked ? THUMB_OFFSET + thumbTravel : THUMB_OFFSET;
      animate(motionX, snapTarget, spring.moderate);
    }

    pointerStart.current = null;
  };

  return (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-labelledby={label === undefined ? undefined : labelId}
      aria-label={label === undefined ? ariaLabel : undefined}
      tabIndex={0}
      className={cn(
        "group/switch relative z-10 flex items-center gap-1 px-2.5 py-1 cursor-pointer select-none touch-none outline-none",
        disabled && "opacity-50 pointer-events-none",
      )}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") {
          setHovered(true);
        }
      }}
      onPointerLeave={() => {
        setHovered(false);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={(e) => {
        if (didDrag.current) {
          e.preventBaseUIHandler();
        }
      }}
    >
      <span
        className={cn(
          "relative shrink-0 rounded-full",
          "transition-colors duration-80",
          "group-focus-visible/switch:ring-1 group-focus-visible/switch:ring-focus-ring group-focus-visible/switch:ring-offset-2 group-focus-visible/switch:ring-offset-background",
        )}
        style={{
          backgroundColor: trackBackground,
          height: m.trackHeight,
          width: m.trackWidth,
        }}
      >
        <SwitchPrimitive.Thumb
          render={(thumbProps) => {
            const { style: baseStyle, ...rest } = motionProps(thumbProps);

            return (
              <motion.span
                {...rest}
                className="absolute top-0 left-0 block rounded-full bg-white shadow-sm"
                initial={false}
                style={motionStyle(baseStyle, { x: motionX })}
                animate={{
                  height: thumbHeight,
                  width: thumbWidth,
                  y: thumbY,
                }}
                transition={spring.moderate}
              />
            );
          }}
        />
      </span>

      {label === undefined ? null : (
        <span
          id={labelId}
          className={cn(
            "[text-box:trim-both_cap_alphabetic] transition-[color] duration-80",
            "text-body",
            checked ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      )}
    </SwitchPrimitive.Root>
  );
};

export { Switch };
