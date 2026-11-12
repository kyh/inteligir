"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import type { CSSProperties, ReactNode, RefAttributes } from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";

import { Tooltip } from "@repo/ui/components/tooltip";
import type { IconComponent } from "@repo/ui/lib/icon";
import { radius } from "@repo/ui/lib/radius";
import { childList, isTextChild } from "@repo/ui/lib/text-children";
import { cn } from "@repo/ui/lib/cn";

const buttonStructure = cva(
  [
    "group relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center outline-none select-none whitespace-nowrap",
    "transition-colors duration-80",
    "disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:ring-1 focus-visible:ring-focus-ring",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    compoundVariants: [
      { className: "pl-[6px]", iconLeft: true, size: "compact" },
      { className: "pl-[10px]", iconLeft: true, size: "default" },
    ],
    defaultVariants: {
      size: "compact",
      variant: "primary",
    },
    variants: {
      iconLeft: { true: "" },
      size: {
        compact: "h-7 gap-1 px-3 text-body [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-9 gap-1.5 px-4 text-subtitle",
        icon: "h-9 w-9 p-0",
        "icon-compact": "h-7 w-7 p-0 [&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        destructive: "text-destructive-foreground",
        ghost: "text-muted-foreground hover:text-foreground",
        primary: "text-background",
        secondary: "text-foreground",
        tertiary: "text-foreground",
      },
    },
  },
);

type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "destructive";

type ButtonSize = "default" | "compact" | "icon" | "icon-compact";

// press: the surface sits 1px inside the button and a same-color shadow spread fills it out; pressing
// collapses the spread 1px per side, where a scale would warp a wide button. fills are opaque
// color-mix, not alpha, so the fill and its spread ring never seam.
const bgVariants = {
  destructive:
    "[--btn-bg:var(--destructive)] group-hover:[--btn-bg:color-mix(in_oklab,var(--destructive)_90%,var(--background))] group-active:[--btn-bg:color-mix(in_oklab,var(--destructive)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  ghost:
    "bg-transparent shadow-[0_0_0_1px_transparent] group-hover:bg-hover group-hover:shadow-[0_0_0_1px_var(--hover)] group-active:bg-active group-active:shadow-[0_0_0_0px_var(--active)]",
  primary:
    "[--btn-bg:var(--foreground)] group-hover:[--btn-bg:color-mix(in_oklab,var(--foreground)_90%,var(--background))] group-active:[--btn-bg:color-mix(in_oklab,var(--foreground)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  secondary:
    "[--btn-bg:var(--accent)] group-hover:[--btn-bg:color-mix(in_oklab,var(--accent)_80%,var(--background))] group-active:[--btn-bg:var(--accent)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  tertiary:
    "bg-transparent shadow-[0_0_0_1px_var(--border),inset_0_0_0_0px_var(--border)] group-hover:bg-hover group-active:bg-active group-active:shadow-[0_0_0_0px_var(--border),inset_0_0_0_1px_var(--border)]",
} satisfies Record<ButtonVariant, string>;

const activeBgVariants = {
  destructive:
    "[--btn-bg:color-mix(in_oklab,var(--destructive)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  ghost: "bg-active shadow-[0_0_0_1px_var(--active)] group-active:shadow-[0_0_0_0px_var(--active)]",
  primary:
    "[--btn-bg:color-mix(in_oklab,var(--foreground)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  secondary:
    "[--btn-bg:var(--accent)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  tertiary:
    "bg-active shadow-[0_0_0_1px_var(--border),inset_0_0_0_0px_var(--border)] group-active:shadow-[0_0_0_0px_var(--border),inset_0_0_0_1px_var(--border)]",
} satisfies Record<ButtonVariant, string>;

// class-string consumers cannot carry the layered press surface, so they get the flat palette on the root.
const flatBgVariants = {
  destructive: "bg-destructive hover:bg-destructive/90",
  ghost: "bg-transparent hover:bg-hover active:bg-active",
  primary: "bg-foreground hover:bg-foreground/90 active:bg-foreground/80",
  secondary: "bg-accent hover:bg-accent/80",
  tertiary: "bg-transparent shadow-[inset_0_0_0_1px_var(--border)] hover:bg-hover active:bg-active",
} satisfies Record<ButtonVariant, string>;

const buttonVariants = (props?: {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
  className?: string;
}): string => {
  const variant = props?.variant ?? "primary";
  const size = props?.size ?? "compact";
  return cn(buttonStructure({ size, variant }), flatBgVariants[variant], props?.className);
};

interface ButtonProps extends Omit<ButtonPrimitive.Props, "className" | "style"> {
  className?: string;
  style?: CSSProperties;
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: IconComponent;
  active?: boolean;
}

// text-box only applies to block containers, so the trim lives on the label span, not the flex root.
const labelTrimClass = "[text-box:trim-both_cap_alphabetic]";

// Text runs are trimmed, and an element child (an icon, a count) is a sibling flex item beside
// them: inside the trimmed block an inline svg does not size the block and is pushed out of its
// line box, above the label.
const labelChildren = (children: ReactNode): ReactNode[] => {
  const nodes = childList(children);
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = (key: number): void => {
    if (run.length > 0) {
      out.push(
        <span key={`text-${String(key)}`} className={labelTrimClass}>
          {run}
        </span>,
      );
      run = [];
    }
  };
  for (const [index, node] of nodes.entries()) {
    if (isTextChild(node)) {
      run.push(node);
    } else {
      flush(index);
      out.push(node);
    }
  }
  flush(nodes.length);
  return out;
};

interface ButtonLabelProps {
  children: ReactNode;
  iconSize: number;
  isIconOnly: boolean;
  leadingIcon: IconComponent | undefined;
}

const ButtonLabel = ({
  children,
  iconSize,
  isIconOnly,
  leadingIcon: LeadingIcon,
}: ButtonLabelProps) => {
  if (isIconOnly) {
    return (
      <span className="inline-flex items-center gap-[inherit] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 [&_svg]:stroke-[1.5] group-hover:[&_svg]:stroke-[2]">
        {labelChildren(children)}
      </span>
    );
  }

  return (
    <>
      {LeadingIcon && (
        <LeadingIcon
          size={iconSize}
          strokeWidth={1.5}
          className="transition-[stroke-width] duration-80 group-hover:stroke-[2]"
        />
      )}
      {labelChildren(children)}
    </>
  );
};

const Button = ({
  className,
  variant,
  size,
  leadingIcon: LeadingIcon,
  active = false,
  disabled,
  children,
  style,
  "aria-label": ariaLabel,
  title,
  ref,
  ...props
}: ButtonProps & RefAttributes<HTMLButtonElement>) => {
  const resolvedSize: ButtonSize = size ?? "compact";
  const resolvedVariant = variant ?? "primary";
  const isIconOnly = resolvedSize === "icon" || resolvedSize === "icon-compact";
  const isCompact = resolvedSize === "compact" || resolvedSize === "icon-compact";
  const iconSize = isCompact ? 14 : 16;
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
        <ButtonLabel iconSize={iconSize} isIconOnly={isIconOnly} leadingIcon={LeadingIcon}>
          {children}
        </ButtonLabel>
      </span>
    </>
  );

  const rootClassName = cn(
    buttonStructure({
      iconLeft: !isIconOnly && !!LeadingIcon,
      size: resolvedSize,
      variant: resolvedVariant,
    }),
    radius.button,
    className,
  );

  // an icon-only button says nothing on its face: its label becomes the product's tooltip
  // and its accessible name, and the native title is dropped so the OS does not show a second one.
  const iconLabel = isIconOnly ? (ariaLabel ?? title) : undefined;
  const element = (
    <ButtonPrimitive
      ref={ref}
      className={rootClassName}
      disabled={disabled}
      style={style}
      aria-label={ariaLabel ?? iconLabel}
      title={isIconOnly ? undefined : title}
      {...props}
    >
      {internals}
    </ButtonPrimitive>
  );
  return iconLabel === undefined ? element : <Tooltip content={iconLabel}>{element}</Tooltip>;
};

export { Button, buttonVariants };
