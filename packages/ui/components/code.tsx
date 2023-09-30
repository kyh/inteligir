import { cn } from "../lib/cn";
import * as React from "react";

const Code = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<"code">
>(({ className, ...props }, ref) => {
  return (
    <code
      ref={ref}
      className={cn(
        "inline-flex rounded-md border border-ui-tag-neutral-border bg-ui-tag-neutral-bg px-[6px] font-mono text-xs text-ui-tag-neutral-text",
        className,
      )}
      {...props}
    />
  );
});

Code.displayName = "Code";

export { Code };
