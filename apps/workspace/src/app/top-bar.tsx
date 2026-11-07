import { cn } from "@repo/ui/lib/cn";
import type { ReactNode } from "react";

import { hasInsetTitleBar } from "./title-bar";

// Tauri drags the window only from a press on this element itself, so it stays childless: a child
// would take the press and drag nothing.
export const TitleBarDragStrip = () =>
  hasInsetTitleBar() ? (
    <div aria-hidden="true" className="h-5 shrink-0" data-tauri-drag-region />
  ) : null;

// The window's top edge beside the rail, and all of it once the rail is off screen: closed, or a
// sheet below the breakpoint the rail leaves the window at (`max-md`, `MOBILE` in sidebar-core).
// `deep` drags by whatever a press lands on here, as a title bar does, and a control keeps its own.
export const TopBar = ({
  railOpen,
  className,
  children,
}: {
  railOpen: boolean;
  className: string;
  children: ReactNode;
}) => {
  const inset = hasInsetTitleBar();
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2",
        className,
        inset && (railOpen ? "max-md:pl-[4.5rem]" : "pl-[4.5rem]"),
      )}
      data-tauri-drag-region={inset ? "deep" : undefined}
    >
      {children}
    </header>
  );
};
