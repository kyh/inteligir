import { cn } from "@repo/ui/lib/cn";
import type { ReactNode } from "react";

import { hasInsetTitleBar } from "./title-bar";

// Tauri drags the window only from a press on this element itself, so it stays childless: a child
// would take the press and drag nothing.
export const TitleBarDragStrip = () =>
  hasInsetTitleBar() ? (
    <div aria-hidden="true" className="h-5 shrink-0" data-tauri-drag-region />
  ) : null;

// the window's top edge beside the rail, and all of it with the rail closed, when the only thing
// left to drag by is this bar's own background
export const TopBar = ({
  underTrafficLights,
  className,
  children,
}: {
  underTrafficLights: boolean;
  className: string;
  children: ReactNode;
}) => (
  <header
    className={cn(
      "flex h-12 shrink-0 items-center gap-2",
      className,
      underTrafficLights && "pl-[4.5rem]",
    )}
    data-tauri-drag-region
  >
    {children}
  </header>
);
