import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { Spinner } from "@repo/ui/components/spinner";
import { cn } from "@repo/ui/lib/utils";

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-focus-ring active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:transition-[stroke-width] group-hover/button:[&_svg]:[stroke-width:2.25]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background shadow-xs hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-4 text-[13px] in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-3 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-9 gap-1.5 px-5 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs":
          "size-6 in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-10",
      },
      loading: {
        true: "disabled:opacity-100",
      },
    },
    compoundVariants: [
      { variant: "default", loading: true, className: "[&>:first-child]:bg-primary" },
      { variant: "destructive", loading: true, className: "[&>:first-child]:bg-destructive/10" },
      { variant: "outline", loading: true, className: "[&>:first-child]:bg-background" },
      { variant: "secondary", loading: true, className: "[&>:first-child]:bg-secondary" },
      { variant: "ghost", loading: true, className: "[&>:first-child]:bg-background" },
      { variant: "link", loading: true, className: "[&>:first-child]:bg-background" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
  };

function Button({
  className,
  variant = "default",
  size = "default",
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, loading, className }))}
      disabled={loading || disabled}
      {...props}
    >
      {loading && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-lg">
          <Spinner className="size-4" />
        </span>
      )}
      {children}
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
