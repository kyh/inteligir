"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "cn";
import { fontWeights } from "@repo/ui/lib/font-weight";
import { useRadius } from "@repo/ui/lib/radius-context";
import { SizeProvider, useSize, type SizeVariant } from "@repo/ui/lib/size-context";
import { ArrowUpIcon } from "lucide-react";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { SurfaceProvider } from "@repo/ui/lib/surface-context";
import { composeRefs } from "@repo/ui/lib/compose-refs";
import { Button } from "@repo/ui/components/button";
import { useIsoLayoutEffect } from "@repo/ui/lib/use-iso-layout-effect";

interface InputMessageProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  size?: SizeVariant;
  value: string;
  onValueChange: (value: string) => void;
  onSend?: (value: string) => void;
  placeholder?: string;
  leftSlot?: ReactNode;
  topSlot?: ReactNode;
  rightSlot?: ReactNode;
  disabled?: boolean;
  minRows?: number;
  maxRows?: number;
  clickToFocus?: boolean;
  sendLabel?: string;
  // the forwarded ref is the container's; this one reaches the textarea
  textareaRef?: Ref<HTMLTextAreaElement>;
  textareaProps?: Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    "value" | "onChange" | "disabled" | "placeholder"
  >;
}

const InputMessage = forwardRef<HTMLDivElement, InputMessageProps>(
  (
    {
      size,
      value,
      onValueChange,
      onSend,
      placeholder = "Ask me anything…",
      leftSlot,
      topSlot,
      rightSlot,
      disabled,
      minRows = 1,
      maxRows = 8,
      clickToFocus = true,
      sendLabel = "Send",
      textareaRef: consumerTextareaRef,
      textareaProps,
      className,
      style,
      ...props
    },
    ref,
  ) => {
    const radius = useRadius();
    const compactStep = useSize(size).variant === "compact";

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [focusVisible, setFocusVisible] = useState(false);
    const [hovered, setHovered] = useState(false);

    const {
      onFocus: _textareaOnFocus,
      onBlur: _textareaOnBlur,
      // runs before the composer's own handling and wins by preventDefault (a mention combobox
      // intercepts the keys the composer treats as submit)
      onKeyDown: consumerOnKeyDown,
      ...restTextareaProps
    } = textareaProps ?? {};

    const lineHeightCache = useRef<{ el: HTMLTextAreaElement; value: number } | null>(null);

    const resizeTextarea = useCallback(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      let cache = lineHeightCache.current;
      if (!cache || cache.el !== el) {
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
        cache = { el, value: Number.isNaN(lineHeight) ? 20 : lineHeight };
        lineHeightCache.current = cache;
      }
      const min = cache.value * minRows;
      const max = cache.value * maxRows;
      const next = Math.min(Math.max(el.scrollHeight, min), max);
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
    }, [minRows, maxRows]);

    useIsoLayoutEffect(() => {
      resizeTextarea();
    }, [value, resizeTextarea]);

    // a mount-time measure at near-zero width reads the wrapped placeholder as many lines and pins
    // maxRows until the next value change; width-gated so the observer cannot loop on its own
    // height writes.
    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      let lastWidth = el.offsetWidth;
      const ro = new ResizeObserver(() => {
        const width = el.offsetWidth;
        if (width === lastWidth) return;
        lastWidth = width;
        resizeTextarea();
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, [resizeTextarea]);

    const trimmed = value.trim();
    const canSend = !disabled && trimmed.length > 0;

    // inline, not a tailwind shadow-* utility, which mangles multi-layer arbitrary values;
    // precedence focus > hover, else the className's shadow-surface-2 supplies the ring.
    const EDGE_DROP = "0 1px 1px -0.5px var(--shadow-color)";
    const edgeShadow = focusVisible
      ? `0 0 0 1px color-mix(in oklab, var(--foreground) 20%, transparent), ${EDGE_DROP}`
      : hovered && clickToFocus && !disabled
        ? `0 0 0 1px var(--border), ${EDGE_DROP}`
        : undefined;

    const handleSend = useCallback(() => {
      if (!canSend) return;
      onSend?.(trimmed);
    }, [canSend, onSend, trimmed]);

    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      },
      [handleSend],
    );

    const handleContainerMouseDown = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!clickToFocus || disabled) return;
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (target === null || target === textareaRef.current) return;
        if (
          target.closest('button, a, input, select, textarea, [contenteditable], [role="button"]')
        ) {
          return;
        }
        e.preventDefault();
        textareaRef.current?.focus();
      },
      [clickToFocus, disabled],
    );

    const composer = (
      <div
        ref={ref}
        onMouseDown={handleContainerMouseDown}
        className={cn(
          "flex flex-col gap-1 p-2 transition-[box-shadow,color] duration-80",
          surfaceClasses(2, 2),
          radius.container,
          clickToFocus && !disabled && "cursor-text",
          disabled && "opacity-50 pointer-events-none",
          className,
        )}
        style={edgeShadow ? { boxShadow: edgeShadow, ...style } : style}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        {...props}
      >
        <SurfaceProvider value={2}>
          {topSlot !== undefined && topSlot !== null ? (
            <div className="flex flex-wrap gap-1.5 pb-1.5">{topSlot}</div>
          ) : null}

          <textarea
            ref={composeRefs(textareaRef, consumerTextareaRef)}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={(e) => {
              consumerOnKeyDown?.(e);
              if (e.defaultPrevented) return;
              handleKeyDown(e);
            }}
            onFocus={(e) => {
              if (e.target.matches(":focus-visible")) setFocusVisible(true);
              textareaProps?.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocusVisible(false);
              textareaProps?.onBlur?.(e);
            }}
            placeholder={placeholder}
            disabled={disabled}
            rows={minRows}
            aria-label={textareaProps?.["aria-label"] ?? "Message"}
            className={cn(
              "w-full resize-none bg-transparent outline-none",
              "text-foreground placeholder:text-muted-foreground",
              compactStep
                ? "text-[13px] leading-[18px] px-1.5 py-1.5"
                : "text-[14px] leading-5 px-2 py-2",
            )}
            style={{ fontVariationSettings: fontWeights.normal }}
            {...restTextareaProps}
          />
          <div
            className={cn(
              "flex items-center justify-between",
              compactStep
                ? "gap-1.5 [&_button]:h-6 [&_button.w-7]:w-6 [&_button]:text-[11px]"
                : "gap-2",
            )}
          >
            <div className="flex items-center gap-1.5 min-w-0">{leftSlot}</div>
            <div className="flex items-center gap-1.5 shrink-0">
              {rightSlot}
              <Button
                type="button"
                variant="primary"
                size="icon-compact"
                onClick={handleSend}
                disabled={!canSend}
                aria-label={sendLabel}
              >
                <ArrowUpIcon
                  size={compactStep ? 15 : 19}
                  className={cn(
                    "block",
                    compactStep ? "!h-[15px] !w-[15px]" : "!h-[19px] !w-[19px]",
                  )}
                />
              </Button>
            </div>
          </div>
        </SurfaceProvider>
      </div>
    );

    return size ? <SizeProvider size={size}>{composer}</SizeProvider> : composer;
  },
);

InputMessage.displayName = "InputMessage";

export { InputMessage };
