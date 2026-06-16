"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@repo/ui/lib/utils";
import { useOnGlass } from "@repo/ui/lib/surface-context";

function Input({ className, ...props }: InputPrimitive.Props) {
  // Inside smoked glass (dialogs, popovers, the composer) the input becomes a
  // lighter translucent white pill with white text — the opaque border/text
  // tokens are unreadable on the theme-invariant dark glass.
  const onGlass = useOnGlass();
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-xl border border-input bg-white/40 px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/40 md:text-sm",
        onGlass &&
          "border-transparent bg-glass-row text-glass-fg caret-white shadow-none file:text-glass-fg placeholder:text-glass-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
