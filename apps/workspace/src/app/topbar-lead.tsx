// The top bar's two ends, which the library's header and an item's bar share: the rail's toggle
// with Back and Forward on the left, the panel's toggle on the right. Back and Forward walk the
// one history, where the library is a step like any item.

import { Button } from "@repo/ui/components/button";
import { useSidebar } from "@repo/ui/components/sidebar-core";
import { cn } from "@repo/ui/lib/cn";
import { ArrowLeftIcon, ArrowRightIcon, PanelLeftIcon, PanelRightIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface TopbarLeadProps {
  // passed in: the bar renders inside the right panel's provider, so `useSidebar()` here is that one
  railOpen: boolean;
  onToggleRail: () => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

export const TopbarLead = ({
  railOpen,
  onToggleRail,
  canBack,
  canForward,
  onBack,
  onForward,
}: TopbarLeadProps) => (
  <>
    <Button
      variant="ghost"
      size="icon-compact"
      aria-label={railOpen ? "Collapse the sidebar" : "Expand the sidebar"}
      aria-expanded={railOpen}
      onClick={onToggleRail}
    >
      <PanelLeftIcon />
    </Button>
    <Button
      variant="ghost"
      size="icon-compact"
      aria-label="Back"
      disabled={!canBack}
      onClick={onBack}
    >
      <ArrowLeftIcon />
    </Button>
    <Button
      variant="ghost"
      size="icon-compact"
      aria-label="Forward"
      disabled={!canForward}
      onClick={onForward}
    >
      <ArrowRightIcon />
    </Button>
  </>
);

export const PanelToggle = () => {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon-compact"
      aria-label="Toggle panel"
      onClick={() => {
        toggleSidebar();
      }}
    >
      <PanelRightIcon />
    </Button>
  );
};

// the bar itself: the window's top edge, where with the rail closed the traffic lights sit
export const TopbarShell = ({
  insetTitleBar,
  railOpen,
  children,
}: {
  insetTitleBar: boolean;
  railOpen: boolean;
  children: ReactNode;
}) => (
  <header
    className={cn(
      "flex h-[var(--app-header-h)] shrink-0 items-center gap-0.5 border-b border-line px-1.5 print:hidden",
      insetTitleBar && !railOpen && "pl-[4.5rem]",
    )}
  >
    {children}
  </header>
);
