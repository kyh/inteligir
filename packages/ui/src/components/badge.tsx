"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { useRadius } from "@repo/ui/lib/radius-context";
import { useSizeVariant } from "@repo/ui/lib/size-context";
import { cn } from "@repo/ui/lib/utils";

const badgeColors = {
  gray: "#a3a3a3",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  fuchsia: "#d946ef",
  pink: "#ec4899",
  rose: "#f43f5e",
};

type BadgeColor = keyof typeof badgeColors;

const badgeVariants = cva("inline-flex items-center font-medium whitespace-nowrap", {
  variants: {
    variant: {
      solid: "",
      dot: "border border-border text-foreground",
      outline: "border border-border text-foreground",
    },
    size: {
      default: "h-6 px-2.5 text-[12px] gap-1.5",
      compact: "h-5 px-2 text-[11px] gap-1",
    },
  },
  defaultVariants: {
    variant: "solid",
    size: "default",
  },
});

type BadgeSize = "default" | "compact";

// text-box needs a block container, so the label gets its own span
const labelClassName = "[text-box:trim-both_cap_alphabetic]";

interface BadgeProps
  extends
    Omit<HTMLAttributes<HTMLSpanElement>, "color">,
    Omit<VariantProps<typeof badgeVariants>, "size"> {
  color?: BadgeColor;
  size?: BadgeSize;
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    { className, variant = "solid", size: sizeProp, color = "gray", children, style, ...props },
    ref,
  ) => {
    const radius = useRadius();
    const contextSize = useSizeVariant();
    const size: BadgeSize = sizeProp ?? (contextSize === "compact" ? "compact" : "default");
    const colorValue = badgeColors[color];
    const showDot = variant === "dot";
    const dotSize = size === "compact" ? 6 : 7;

    const colorStyle =
      variant === "solid"
        ? color === "gray"
          ? { backgroundColor: "var(--accent)", color: "var(--foreground)" }
          : {
              color: "var(--foreground)",
              backgroundColor: `color-mix(in srgb, ${colorValue} 15%, var(--background))`,
            }
        : {};

    const dotColor = color === "gray" ? "var(--muted-foreground)" : colorValue;

    return (
      <span
        ref={ref}
        className={cn(badgeVariants({ variant, size }), radius.item, className)}
        style={{ ...colorStyle, ...style }}
        {...props}
      >
        {showDot && (
          <span
            className="shrink-0 rounded-full"
            style={{
              width: dotSize,
              height: dotSize,
              backgroundColor: dotColor,
            }}
          />
        )}
        <span className={labelClassName}>{children}</span>
      </span>
    );
  },
);

Badge.displayName = "Badge";

export { Badge };
