import type { ReactNode } from "react";

import { cn } from "cn";

interface CollapseProps {
  open: boolean;
  className?: string;
  innerClassName?: string;
  children: ReactNode;
}

// a closed fold is inert, never aria-hidden, which leaves the clipped controls in the tab order
export function Collapse({ open, className, innerClassName, children }: CollapseProps) {
  return (
    <div
      inert={open ? undefined : true}
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
