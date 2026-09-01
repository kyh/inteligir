import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

interface CollapseProps {
  open: boolean;
  className?: string;
  /** Extra classes on the clipping box — for content that needs breathing
   *  room inside the clip (hover pills, negative-margin gutters). */
  innerClassName?: string;
  children: ReactNode;
}

/** The 0fr → 1fr grid collapse: animatable without measuring content, one
 *  easing for every fold in the system so expands read as one gesture. */
export function Collapse({ open, className, innerClassName, children }: CollapseProps) {
  return (
    <div
      aria-hidden={open ? undefined : true}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        className,
      )}
      style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
    >
      <div className={cn("overflow-hidden", innerClassName)}>{children}</div>
    </div>
  );
}
