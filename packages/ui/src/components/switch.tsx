"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { animate, motion, useMotionValue } from "framer-motion";

import { useSize, type SizeVariant } from "@repo/ui/lib/size-context";
import { motionProps, motionStyle } from "@repo/ui/lib/motion-style";
import { spring } from "@repo/ui/lib/springs";
import { cn } from "@repo/ui/lib/utils";

interface SwitchProps extends HTMLAttributes<HTMLDivElement> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: SizeVariant;
}

const METRICS = {
  default: {
    trackWidth: 34,
    trackHeight: 20,
    thumbSize: 16,
    pillExtend: 2,
    pressExtend: 4,
    pressShrink: 4,
  },
  compact: {
    trackWidth: 28,
    trackHeight: 16,
    thumbSize: 12,
    pillExtend: 2,
    pressExtend: 3,
    pressShrink: 3,
  },
} as const;

const THUMB_OFFSET = 2;
const DRAG_DEAD_ZONE = 2;

const Switch = forwardRef<HTMLDivElement, SwitchProps>(
  (
    {
      checked,
      onCheckedChange,
      label,
      disabled = false,
      size,
      className,
      "aria-label": ariaLabel,
      ...props
    },
    ref,
  ) => {
    const labelId = useId();
    const hasMounted = useRef(false);
    const [hovered, setHovered] = useState(false);
    const [pressed, setPressed] = useState(false);
    const sizeClasses = useSize(size);
    const m = METRICS[sizeClasses.variant];
    const thumbTravel = m.trackWidth - m.thumbSize - THUMB_OFFSET * 2;

    const dragging = useRef(false);
    const didDrag = useRef(false);
    const pointerStart = useRef<{
      clientX: number;
      originX: number;
    } | null>(null);

    const motionX = useMotionValue(checked ? THUMB_OFFSET + thumbTravel : THUMB_OFFSET);

    useEffect(() => {
      hasMounted.current = true;
    }, []);

    const thumbWidth = pressed
      ? m.thumbSize + m.pressExtend
      : hovered
        ? m.thumbSize + m.pillExtend
        : m.thumbSize;
    const thumbHeight = pressed ? m.thumbSize - m.pressShrink : m.thumbSize;
    const thumbY = pressed ? THUMB_OFFSET + m.pressShrink / 2 : THUMB_OFFSET;
    const extraWidth = thumbWidth - m.thumbSize;
    const thumbX = checked ? THUMB_OFFSET + thumbTravel - extraWidth : THUMB_OFFSET;

    useEffect(() => {
      if (dragging.current) return;
      if (!hasMounted.current) {
        motionX.set(thumbX);
      } else {
        animate(motionX, thumbX, spring.moderate);
      }
    }, [thumbX, motionX]);

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (disabled) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        setPressed(true);
        dragging.current = false;
        didDrag.current = false;
        pointerStart.current = {
          clientX: e.clientX,
          originX: motionX.get(),
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      [disabled, motionX],
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (!pointerStart.current) return;
        const delta = e.clientX - pointerStart.current.clientX;

        if (!dragging.current) {
          if (Math.abs(delta) < DRAG_DEAD_ZONE) return;
          dragging.current = true;
        }

        const dragMin = THUMB_OFFSET;
        const pressedThumbWidth = m.thumbSize + m.pressExtend;
        const dragMax = m.trackWidth - THUMB_OFFSET - pressedThumbWidth;
        const rawX = pointerStart.current.originX + delta;
        motionX.set(Math.max(dragMin, Math.min(dragMax, rawX)));
      },
      [motionX, m],
    );

    const handlePointerUp = useCallback(() => {
      if (!pointerStart.current) return;
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

        if (shouldBeOn !== checked) {
          onCheckedChange(shouldBeOn);
        } else {
          const snapTarget = checked ? THUMB_OFFSET + thumbTravel : THUMB_OFFSET;
          animate(motionX, snapTarget, spring.moderate);
        }

        requestAnimationFrame(() => {
          didDrag.current = false;
        });
      }

      pointerStart.current = null;
    }, [checked, onCheckedChange, motionX, m, thumbTravel]);

    const handlePointerCancel = useCallback(() => {
      if (!pointerStart.current) return;
      setPressed(false);

      if (dragging.current) {
        dragging.current = false;
        const snapTarget = checked ? THUMB_OFFSET + thumbTravel : THUMB_OFFSET;
        animate(motionX, snapTarget, spring.moderate);
      }

      pointerStart.current = null;
    }, [checked, motionX, thumbTravel]);

    return (
      <div
        ref={ref}
        className={cn(
          "relative z-10 flex items-center cursor-pointer select-none touch-none",
          sizeClasses.gap,
          sizeClasses.px,
          sizeClasses.variant === "compact" ? "py-1" : "py-2",
          disabled && "opacity-50 pointer-events-none",
          className,
        )}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={() => {
          if (disabled || didDrag.current) return;
          onCheckedChange(!checked);
        }}
        {...props}
      >
        <SwitchPrimitive.Root
          checked={checked}
          aria-labelledby={label === undefined ? undefined : labelId}
          aria-label={label === undefined ? ariaLabel : undefined}
          onCheckedChange={(next) => {
            if (didDrag.current) return;
            onCheckedChange(next);
          }}
          disabled={disabled}
          tabIndex={0}
          className={cn(
            "relative shrink-0 rounded-full outline-none cursor-pointer",
            "transition-colors duration-80",
            "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
          style={{
            width: m.trackWidth,
            height: m.trackHeight,
            backgroundColor: checked
              ? hovered
                ? "color-mix(in oklab, var(--primary), rgb(var(--overlay)) 12%)"
                : "var(--primary)"
              : hovered
                ? "color-mix(in oklab, var(--accent), rgb(var(--overlay)) 10%)"
                : "var(--accent)",
          }}
          onClick={(e) => e.stopPropagation()}
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
                    y: thumbY,
                    width: thumbWidth,
                    height: thumbHeight,
                  }}
                  transition={hasMounted.current ? spring.moderate : { duration: 0 }}
                />
              );
            }}
          />
        </SwitchPrimitive.Root>

        {label === undefined ? null : (
          <span
            id={labelId}
            className={cn(
              "[text-box:trim-both_cap_alphabetic] transition-[color] duration-80",
              sizeClasses.text,
              checked ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
        )}
      </div>
    );
  },
);

Switch.displayName = "Switch";

export { Switch };
