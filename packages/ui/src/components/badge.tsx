"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import type { HTMLAttributes, RefAttributes } from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { useRadius } from "@repo/ui/lib/radius-context";
import { useSizeVariant } from "@repo/ui/lib/size-context";
import { cn } from "cn";

const badgeColors = {
  amber: "#f59e0b",
  blue: "#3b82f6",
  cyan: "#06b6d4",
  emerald: "#10b981",
  fuchsia: "#d946ef",
  gray: "#a3a3a3",
  green: "#22c55e",
  indigo: "#6366f1",
  lime: "#84cc16",
  orange: "#f97316",
  pink: "#ec4899",
  purple: "#a855f7",
  red: "#ef4444",
  rose: "#f43f5e",
  teal: "#14b8a6",
  violet: "#8b5cf6",
  yellow: "#eab308",
};

type BadgeColor = keyof typeof badgeColors;

const badgeVariants = cva("inline-flex items-center font-medium whitespace-nowrap", {
  defaultVariants: {
    size: "default",
    variant: "solid",
  },
  variants: {
    size: {
      compact: "h-5 px-2 text-[11px] gap-1",
      default: "h-6 px-2.5 text-[12px] gap-1.5",
    },
    variant: {
      dot: "border border-border text-foreground",
      outline: "border border-border text-foreground",
      solid: "",
    },
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

const Badge = ({
  className,
  variant = "solid",
  size: sizeProp,
  color = "gray",
  children,
  style,
  ref,
  ...props
}: BadgeProps & RefAttributes<HTMLSpanElement>) => {
  const radius = useRadius();
  const contextSize = useSizeVariant();
  const size: BadgeSize = sizeProp ?? (contextSize === "compact" ? "compact" : "default");
  const colorValue = badgeColors[color];
  const showDot = variant === "dot";
  const dotSize = size === "compact" ? 6 : 7;

  const solidStyle =
    color === "gray"
      ? { backgroundColor: "var(--accent)", color: "var(--foreground)" }
      : {
          backgroundColor: `color-mix(in srgb, ${colorValue} 15%, var(--background))`,
          color: "var(--foreground)",
        };
  const colorStyle = variant === "solid" ? solidStyle : {};

  const dotColor = color === "gray" ? "var(--muted-foreground)" : colorValue;

  return (
    <span
      ref={ref}
      className={cn(badgeVariants({ size, variant }), radius.item, className)}
      style={{ ...colorStyle, ...style }}
      {...props}
    >
      {showDot && (
        <span
          className="shrink-0 rounded-full"
          style={{
            backgroundColor: dotColor,
            height: dotSize,
            width: dotSize,
          }}
        />
      )}
      <span className={labelClassName}>{children}</span>
    </span>
  );
};

Badge.displayName = "Badge";

export { Badge };
