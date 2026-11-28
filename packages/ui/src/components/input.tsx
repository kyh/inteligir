// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).
import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@repo/ui/lib/cn";

export const fieldClasses =
  "w-full min-w-0 rounded-lg border border-border bg-transparent px-3 text-body text-foreground outline-none pointer-coarse:text-[16px] transition-[background-color,border-color] duration-80 placeholder:text-muted-foreground hover:bg-hover aria-invalid:border-destructive/50 focus:border-foreground/40 aria-invalid:focus:border-foreground/40 focus:hover:bg-transparent disabled:pointer-events-none disabled:opacity-50";

const Input = ({ className, type, ...props }: React.ComponentProps<"input">) => (
  <InputPrimitive
    type={type}
    data-slot="input"
    className={cn(
      fieldClasses,
      "h-9 file:mr-2 file:cursor-pointer file:border-0 file:bg-transparent file:p-0 file:font-[inherit] file:text-[length:inherit] file:text-foreground",
      className,
    )}
    {...props}
  />
);

export { Input };
