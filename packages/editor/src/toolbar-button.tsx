// mousedown preventDefault is built in so a click never steals the editor selection.

import type { ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

export function BarButton({
  onClick,
  title,
  children,
  variant = "default",
}: {
  onClick: () => void;
  title?: string;
  children: ReactNode;
  variant?: "default" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors [&_svg]:size-3.5",
        variant === "default" && "text-foreground hover:bg-accent",
        variant === "primary" && "text-primary hover:bg-primary/10",
        variant === "danger" && "text-muted-foreground hover:bg-muted hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}
