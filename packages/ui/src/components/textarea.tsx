"use client";

import * as React from "react";

import { cn } from "@repo/ui/lib/utils";
import { useOnGlass } from "@repo/ui/lib/surface-context";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  // Inside smoked glass the textarea becomes a lighter translucent white pill
  // with white text (same recipe as Input — glass is dark in both themes).
  const onGlass = useOnGlass();
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-xl border border-input bg-white/40 px-2.5 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/40 md:text-sm",
        onGlass &&
          "border-transparent bg-glass-row text-glass-fg caret-white shadow-none placeholder:text-glass-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
