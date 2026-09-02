"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import { forwardRef, type CSSProperties } from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";

import type { IconComponent } from "@repo/ui/lib/icon";
import { useRadius } from "@repo/ui/lib/radius-context";
import { useSizeVariant } from "@repo/ui/lib/size-context";
import { cn } from "@repo/ui/lib/utils";

const buttonStructure = cva(
  [
    "group relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center outline-none select-none whitespace-nowrap",
    "transition-colors duration-80",
    "disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        primary: "text-background",
        secondary: "text-foreground",
        tertiary: "text-foreground",
        ghost: "text-muted-foreground hover:text-foreground",
        destructive: "text-destructive-foreground",
      },
      // The two-step ladder: default = 36px control height, compact = 28px
      // for dense surfaces.
      size: {
        default: "h-9 gap-1.5 px-4 text-[13px]",
        compact: "h-7 gap-1 px-3 text-[12px] [&_svg:not([class*='size-'])]:size-3.5",
        icon: "h-9 w-9 p-0",
        "icon-compact": "h-7 w-7 p-0 [&_svg:not([class*='size-'])]:size-3.5",
      },
      iconLeft: { true: "" },
      iconRight: { true: "" },
    },
    compoundVariants: [
      { size: "compact", iconLeft: true, className: "pl-[6px]" },
      { size: "default", iconLeft: true, className: "pl-[10px]" },
      { size: "compact", iconRight: true, className: "pr-[6px]" },
      { size: "default", iconRight: true, className: "pr-[10px]" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "destructive";

type ButtonSize = "default" | "compact" | "icon" | "icon-compact";

/* Press effect: the surface layer sits 1px inside the button and a
   same-color box-shadow spread fills it back out to the full bounds.
   Pressing collapses the spread, shrinking the surface by exactly 1px per
   side at any width — a scale would warp (2% of a 400px button is 8px
   sideways but under 1px vertically). Fill colors are opaque color-mix()es
   rather than alpha so the fill and its spread ring never seam. */
const bgVariants = {
  primary:
    "[--btn-bg:var(--foreground)] group-hover:[--btn-bg:color-mix(in_oklab,var(--foreground)_90%,var(--background))] group-active:[--btn-bg:color-mix(in_oklab,var(--foreground)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  secondary:
    "[--btn-bg:var(--accent)] group-hover:[--btn-bg:color-mix(in_oklab,var(--accent)_80%,var(--background))] group-active:[--btn-bg:var(--accent)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  // The border ring is an outer 1px shadow at rest that hands off to an
  // inset 1px shadow when pressed, so the ring moves inward with the
  // surface. The translucent fill only ever reaches the ring's inner edge
  // (exactly the surface box), so it needs no spread of its own.
  tertiary:
    "bg-transparent shadow-[0_0_0_1px_var(--border),inset_0_0_0_0px_var(--border)] group-hover:bg-hover group-active:bg-active group-active:shadow-[0_0_0_0px_var(--border),inset_0_0_0_1px_var(--border)]",
  // Translucent fill + same-color spread never double up: outer shadows
  // render only outside the surface box.
  ghost:
    "bg-transparent shadow-[0_0_0_1px_transparent] group-hover:bg-hover group-hover:shadow-[0_0_0_1px_var(--hover)] group-active:bg-active group-active:shadow-[0_0_0_0px_var(--active)]",
  // Local addition to fluid's variant vocabulary: primary's press mechanics
  // over the destructive tokens, for confirm-style dangerous actions.
  destructive:
    "[--btn-bg:var(--destructive)] group-hover:[--btn-bg:color-mix(in_oklab,var(--destructive)_90%,var(--background))] group-active:[--btn-bg:color-mix(in_oklab,var(--destructive)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
} satisfies Record<ButtonVariant, string>;

/* Forced-active (`active` prop): pressed colors at full size; the
   geometric press-collapse still reacts on top. */
const activeBgVariants = {
  primary:
    "[--btn-bg:color-mix(in_oklab,var(--foreground)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  secondary:
    "[--btn-bg:var(--accent)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  tertiary:
    "bg-active shadow-[0_0_0_1px_var(--border),inset_0_0_0_0px_var(--border)] group-active:shadow-[0_0_0_0px_var(--border),inset_0_0_0_1px_var(--border)]",
  ghost: "bg-active shadow-[0_0_0_1px_var(--active)] group-active:shadow-[0_0_0_0px_var(--active)]",
  destructive:
    "[--btn-bg:color-mix(in_oklab,var(--destructive)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
} satisfies Record<ButtonVariant, string>;

/* The layered press surface can't ride a class string, so class-string
   consumers (calendar's DayPicker buttons) get a flat rendition: the same
   palette painted on the root, without the 1px press collapse. */
const flatBgVariants = {
  primary: "bg-foreground hover:bg-foreground/90 active:bg-foreground/80",
  secondary: "bg-accent hover:bg-accent/80",
  tertiary: "bg-transparent shadow-[inset_0_0_0_1px_var(--border)] hover:bg-hover active:bg-active",
  ghost: "bg-transparent hover:bg-hover active:bg-active",
  destructive: "bg-destructive hover:bg-destructive/90",
} satisfies Record<ButtonVariant, string>;

function buttonVariants(props?: {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
  className?: string;
}): string {
  const variant = props?.variant ?? "primary";
  const size = props?.size ?? "default";
  return cn(buttonStructure({ variant, size }), flatBgVariants[variant], props?.className);
}

interface ButtonProps extends Omit<ButtonPrimitive.Props, "className" | "style"> {
  className?: string;
  style?: CSSProperties;
  variant?: ButtonVariant;
  /** Omitted, the button follows the surrounding SizeProvider (default 36px,
   *  compact 28px). */
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  /** Force the visual pressed/held state. Useful when the button drives an
   *  external open piece of UI (a popover, dropdown, etc.) so it reads as
   *  engaged while the menu is showing. */
  active?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      loading = false,
      leadingIcon: LeadingIcon,
      trailingIcon: TrailingIcon,
      active = false,
      disabled,
      children,
      style,
      ...props
    },
    ref,
  ) => {
    // Resolve the size: explicit prop > surrounding SizeProvider > default.
    const contextSize = useSizeVariant();
    const resolvedSize: ButtonSize = size ?? (contextSize === "compact" ? "compact" : "default");
    const resolvedVariant = variant ?? "primary";
    const isIconOnly = resolvedSize === "icon" || resolvedSize === "icon-compact";
    const isCompact = resolvedSize === "compact" || resolvedSize === "icon-compact";
    const iconSize = isCompact ? 14 : 16;
    // Spinner box tracks the button height so the loading glyph stays
    // proportionate across sizes. size-* spelling on purpose: the base
    // [&_svg:not([class*='size-'])] guard must skip the spinner.
    const spinnerSizeClass = isCompact ? "size-7" : "size-9";
    const radius = useRadius();
    // text-box only applies to block containers, so the trim lives on the
    // label span (a blockified flex item), not the flex root. The button's
    // height is fixed (h-*), so this doesn't change layout — it just centers
    // the cap-to-baseline box optically.
    const labelTrimClass = "[text-box:trim-both_cap_alphabetic]";
    const bgClass = active ? activeBgVariants[resolvedVariant] : bgVariants[resolvedVariant];

    const internals = (
      <>
        <span
          aria-hidden
          className={cn(
            "absolute inset-px rounded-[inherit] transition-[box-shadow,background-color] [transition-duration:180ms,80ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1),ease] group-active:[transition-duration:80ms,80ms]",
            bgClass,
          )}
        />
        <span className="relative inline-flex items-center justify-center gap-[inherit]">
          {loading ? (
            <>
              <span className="flex items-center justify-center gap-[inherit] opacity-0">
                {LeadingIcon && !isIconOnly && <LeadingIcon size={iconSize} strokeWidth={2} />}
                {children}
                {TrailingIcon && !isIconOnly && <TrailingIcon size={iconSize} strokeWidth={2} />}
              </span>
              <span className="absolute inset-0 flex items-center justify-center">
                <svg className={spinnerSizeClass} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z"
                    stroke="currentColor"
                    strokeWidth="1.125"
                    strokeLinecap="round"
                    pathLength="100"
                    style={{
                      strokeDasharray: "15 85",
                      animation:
                        "spinner-move 2s linear infinite, spinner-dash 4s ease-in-out infinite",
                    }}
                  />
                </svg>
              </span>
            </>
          ) : isIconOnly ? (
            <span className="[&_svg]:transition-[stroke-width] [&_svg]:duration-80 [&_svg]:stroke-[1.5] group-hover:[&_svg]:stroke-[2]">
              {children}
            </span>
          ) : (
            <>
              {LeadingIcon && (
                <LeadingIcon
                  size={iconSize}
                  strokeWidth={1.5}
                  className="transition-[stroke-width] duration-80 group-hover:stroke-[2]"
                />
              )}
              <span className={labelTrimClass}>{children}</span>
              {TrailingIcon && (
                <TrailingIcon
                  size={iconSize}
                  strokeWidth={1.5}
                  className="transition-[stroke-width] duration-80 group-hover:stroke-[2]"
                />
              )}
            </>
          )}
        </span>
      </>
    );

    const rootClassName = cn(
      buttonStructure({
        variant: resolvedVariant,
        size: resolvedSize,
        iconLeft: !isIconOnly && !!LeadingIcon,
        iconRight: !isIconOnly && !!TrailingIcon,
      }),
      radius.button,
      className,
    );

    return (
      <ButtonPrimitive
        ref={ref}
        className={rootClassName}
        disabled={disabled || loading}
        style={style}
        {...props}
      >
        {internals}
      </ButtonPrimitive>
    );
  },
);

Button.displayName = "Button";

export { Button, buttonVariants };
