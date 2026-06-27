"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@repo/ui/lib/utils";
import { useOnGlass } from "@repo/ui/lib/surface-context";

// Visual parity with Ophelias' compact controls: the background lives on a
// layered span that scales on press, text/border colors live on the root, and
// icons morph stroke-width on hover. The shadcn variant names are kept so app
// call sites don't change.
const buttonVariants = cva(
  [
    "group/button relative isolate inline-flex shrink-0 items-center justify-center rounded-[10px] whitespace-nowrap font-medium outline-none cursor-pointer select-none",
    "text-box-trim-both text-box-edge-cap-alphabetic",
    "transition-[color,scale] duration-80 active:scale-[0.97] aria-expanded:scale-[0.97]",
    "disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:ring-1 focus-visible:ring-focus-ring",
    "aria-invalid:ring-1 aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:[stroke-width:1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 group-hover/button:[&_svg]:[stroke-width:2]",
  ],
  {
    variants: {
      variant: {
        default: "text-[#f8f8f8]",
        secondary: "text-[rgb(19_20_27_/_0.8)]",
        outline: "border border-border text-foreground",
        ghost: "text-muted-foreground hover:text-foreground aria-expanded:text-foreground",
        destructive: "text-destructive",
        link: "text-primary underline-offset-4 hover:underline",
        // Circular glass icon button ("puck") — gray translucent circle with a
        // white icon in BOTH themes. Pair with an icon size (default `icon`,
        // 36px) and stack vertically with `flex flex-col gap-2`.
        glass: "rounded-full text-puck-fg",
      },
      size: {
        default: "h-8 gap-1.5 px-4 text-[13px]",
        xs: "h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-3 text-xs",
        lg: "h-9 gap-1.5 px-5 text-sm",
        icon: "size-9 p-0",
        "icon-xs": "size-6 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 p-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10 p-0 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

// Background layer per variant — hover/active/expanded states live here so the
// fill can scale independently of the (sharp) text.
const bgVariants: Record<string, string> = {
  default:
    "bg-[rgb(65_65_65_/_0.45)] backdrop-blur-[10px] group-hover/button:bg-[rgb(65_65_65_/_0.56)] group-active/button:bg-[rgb(65_65_65_/_0.62)] group-aria-expanded/button:bg-[rgb(65_65_65_/_0.62)]",
  secondary:
    "bg-[#e5e7e7] group-hover/button:bg-[#dfe2e2] group-active/button:bg-[#d8dddd] group-aria-expanded/button:bg-[#d8dddd]",
  outline:
    "bg-background shadow-xs group-hover/button:bg-hover group-active/button:bg-active group-aria-expanded/button:bg-active",
  ghost:
    "bg-transparent group-hover/button:bg-hover group-active/button:bg-active group-aria-expanded/button:bg-active",
  destructive:
    "bg-destructive/10 group-hover/button:bg-destructive/20 group-active/button:bg-destructive/20",
  glass:
    "glass-puck group-hover/button:bg-puck-hover group-active/button:bg-puck-hover group-aria-expanded/button:bg-puck-hover",
};

// On smoked glass (GlassProvider subtrees: dialogs, menus, popovers, the
// composer) the opaque-ladder colors are unreadable — each variant swaps to
// the glass-inner pill recipe: lighter translucent white fills, white text.
// Same variant names, so call sites don't change. The `glass` (puck) variant
// is already glass-native and keeps its base styling.
const glassTextVariants: Record<string, string> = {
  default: "text-white",
  secondary: "text-glass-fg",
  outline: "border-white/15 text-glass-fg",
  ghost: "text-glass-fg-muted hover:text-glass-fg aria-expanded:text-glass-fg",
  destructive: "text-[#ffb4ab]",
  link: "text-glass-fg",
};

const glassBgVariants: Record<string, string> = {
  default:
    "bg-glass-row-active group-hover/button:bg-white/35 group-active/button:bg-white/30 group-aria-expanded/button:bg-white/30",
  secondary:
    "bg-glass-row group-hover/button:bg-glass-row-hover group-active/button:bg-glass-row-active group-aria-expanded/button:bg-glass-row-active",
  outline:
    "bg-transparent shadow-none group-hover/button:bg-glass-row group-active/button:bg-glass-row-hover group-aria-expanded/button:bg-glass-row-hover",
  ghost:
    "bg-transparent group-hover/button:bg-glass-row group-active/button:bg-glass-row-hover group-aria-expanded/button:bg-glass-row-hover",
  destructive: "bg-white/10 group-hover/button:bg-white/15 group-active/button:bg-white/15",
};

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
    /** Force the pressed/held look (e.g. while a menu this triggers is open). */
    active?: boolean;
  };

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  active = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const v = variant ?? "default";
  const onGlass = useOnGlass();
  const bg = (onGlass ? glassBgVariants[v] : undefined) ?? bgVariants[v];

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(
        buttonVariants({ variant, size }),
        onGlass && glassTextVariants[v],
        active && "scale-[0.97]",
        className,
      )}
      disabled={loading || disabled}
      {...props}
    >
      {bg && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-[inherit] bg-clip-padding transition-[background-color] duration-80",
            bg,
          )}
        />
      )}
      <span
        className={cn(
          "relative inline-flex items-center justify-center gap-[inherit]",
          loading && "opacity-0",
        )}
      >
        {children}
      </span>
      {loading && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg className="size-5" viewBox="0 0 24 24" fill="none">
            <path
              d="M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z"
              stroke="currentColor"
              strokeWidth="1.125"
              strokeLinecap="round"
              pathLength="100"
              style={{
                strokeDasharray: "15 85",
                animation: "spinner-move 2s linear infinite, spinner-dash 4s ease-in-out infinite",
              }}
            />
          </svg>
        </span>
      )}
    </ButtonPrimitive>
  );
}

export { Button };
