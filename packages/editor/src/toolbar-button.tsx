// mousedown preventDefault is built in so a click never steals the editor selection.

import type { ReactNode } from "react";

import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "cn";

export function BarButton({
  onClick,
  label,
  children,
  variant = "default",
}: {
  onClick: () => void;
  /** For an icon-only face: the tooltip and the accessible name. A face with text needs none. */
  label?: string;
  children: ReactNode;
  variant?: "default" | "primary" | "danger";
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
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
  return label === undefined ? button : <Tooltip content={label}>{button}</Tooltip>;
}
