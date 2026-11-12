"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import type { ReactNode } from "react";

import { radius } from "@repo/ui/lib/radius";
import { cn } from "@repo/ui/lib/cn";

// text-box needs a block container, so the label gets its own span
const Badge = ({ children }: { children: ReactNode }) => (
  <span
    className={cn(
      "inline-flex h-5 items-center gap-1 whitespace-nowrap border border-border px-2 text-caption font-medium text-foreground",
      radius.item,
    )}
  >
    <span className="[text-box:trim-both_cap_alphabetic]">{children}</span>
  </span>
);

export { Badge };
