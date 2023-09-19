import * as React from "react";
import { cn } from "../lib/cn";
import { inputBaseStyles } from "./input";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        inputBaseStyles,
        "txt-medium min-h-[70px] w-full rounded-md border px-3 py-[7px]",
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
