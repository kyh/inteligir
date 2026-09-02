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
import { cn } from "@repo/ui/lib/utils";
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
  /** Step on the size ladder. Wins over the surrounding SizeProvider and
   *  propagates to the composer's rows and buttons. */
  size?: SizeVariant;
  /** Controlled textarea value. */
  value: string;
  /** Called with the new value on every textarea change. */
  onValueChange: (value: string) => void;
  /** Fired with the trimmed value when the user submits (Enter or the send
   *  button). */
  onSend?: (value: string) => void;
  /** Placeholder text shown when the value is empty. */
  placeholder?: string;
  /** Content rendered in the bottom-left action area. */
  leftSlot?: ReactNode;
  /** Content rendered inside the card ABOVE the textarea (context chips). */
  topSlot?: ReactNode;
  /** Content rendered in the bottom-right action area, before the built-in
   *  send button. */
  rightSlot?: ReactNode;
  /** Disables the textarea and send button. */
  disabled?: boolean;
  /** Minimum visible rows before the textarea grows. */
  minRows?: number;
  /** Maximum visible rows before the textarea starts to scroll. */
  maxRows?: number;
  /** When false, clicking the surrounding container won't refocus the textarea. */
  clickToFocus?: boolean;
  /** Accessible label for the send button. */
  sendLabel?: string;
  /** The underlying textarea element, for consumers that do caret surgery
   *  (the forwarded ref is the container's). */
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Extra props forwarded to the underlying textarea. */
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

    // Split out onFocus/onBlur so the rest-spread onto the textarea can't
    // clobber the composed handlers below.
    const {
      onFocus: _textareaOnFocus,
      onBlur: _textareaOnBlur,
      // The consumer's onKeyDown runs BEFORE the composer's own handling and
      // wins by preventDefault — a mention combobox must intercept the keys
      // the composer would otherwise treat as submit.
      onKeyDown: consumerOnKeyDown,
      ...restTextareaProps
    } = textareaProps ?? {};

    // Parsed line-height, cached per textarea element — getComputedStyle on
    // every keystroke is needless work when the value only changes with font
    // or zoom changes.
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

    // Re-measure when the textarea's width changes. The mount-time pass can
    // run while an ancestor is still laid out at (near-)zero width — the
    // wrapped placeholder then reads as many lines and pins the height at
    // maxRows until the next value change. Width-gated so the observer
    // doesn't loop on its own height writes.
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

    // Edge = the box-shadow's 1px ring, recoloured in place per state so the
    // stroke gains contrast without ever appearing to thicken (no second
    // border band layered beside it). The drop (`0 1px 1px`) is kept so the
    // composer holds its lift across states. Applied inline (not via a Tailwind
    // `shadow-*` utility, which mangles multi-layer arbitrary values) with the
    // precedence focus > hover; when neither is active, the className's
    // `shadow-surface-2` supplies the resting edge.
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

    // The send glyph overrides icon-compact's small 14px svg — it reads
    // better a touch larger, and `size` matches the attribute to the CSS so
    // the svg box stays centered.
    const composer = (
      <div
        ref={ref}
        onMouseDown={handleContainerMouseDown}
        className={cn(
          // The edge is the box-shadow's hairline ring (from surface-2), not a
          // border. State changes recolor that same 1px ring in place rather
          // than layering a second colored border beside it — so hover / focus
          // bump *contrast* without ever appearing to thicken the stroke.
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
            // Compose the consumer's textareaProps handlers with the internal
            // focus-visible tracking (the spread below would otherwise
            // overwrite these).
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
              // The footer's controls sit one notch below the composer's step:
              // slot content is consumer-authored (usually compact-pinned
              // Buttons), so the compact step scales any button in the row —
              // send button included — down to 24px via a scoped override.
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

    // A size prop pins the whole composer — inner buttons included — to one
    // ladder step (matches InputGroup).
    return size ? <SizeProvider size={size}>{composer}</SizeProvider> : composer;
  },
);

InputMessage.displayName = "InputMessage";

export { InputMessage };
