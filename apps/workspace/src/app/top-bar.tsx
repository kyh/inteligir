import { cn } from "@repo/ui/lib/cn";
import type { ReactNode } from "react";

export const TopBar = ({ className, children }: { className: string; children: ReactNode }) => (
  <header className={cn("flex h-12 shrink-0 items-center gap-2", className)}>{children}</header>
);
