import * as React from "react";
import { cn } from "../lib/cn";

const Kbd = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<"kbd">
>(({ children, className, ...props }, ref) => {
  return (
    <kbd
      {...props}
      className={cn(
        "inline-flex h-5 w-fit min-w-[20px] items-center justify-center rounded-md border border-ui-tag-neutral-border bg-ui-tag-neutral-bg px-1 text-ui-tag-neutral-text",
        "text-xs",
        className,
      )}
      ref={ref}
    >
      {children}
    </kbd>
  );
});
Kbd.displayName = "Kbd";

export { Kbd };
