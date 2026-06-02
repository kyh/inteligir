import { useMemo } from "react";

import { cn } from "@repo/ui/lib/utils";
import { toast } from "@repo/ui/components/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/components/tooltip";
import { BUILTIN_WIDGET_UI } from "@/renderer/shell/builtin-widgets";
import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useShellStore } from "@/renderer/stores/shell-store";
import { getSessionStatus, type SessionStatus } from "@/shared/agent";
import { BUILTIN_DEFS } from "@/shared/shell";

// The left dock is the vertical launcher for built-in widget panels. Chat
// input and voice now live in the BottomDock; custom (JSON-UI) widgets live in
// the Widgets panel — so this stays fixed-size no matter what's installed.

// The orb is the first item: a status-only indicator (not a launcher). Its
// gradient + label reflect the agent's current session status.
const ORB_GRADIENT: Record<SessionStatus, string> = {
  idle: "from-sky-300 to-blue-600",
  busy: "from-amber-300 to-orange-500 animate-pulse",
  error: "from-red-400 to-rose-600",
  starting: "from-sky-200 to-blue-500 animate-pulse",
};
const ORB_LABEL: Record<SessionStatus, string> = {
  idle: "Ready",
  busy: "Working…",
  error: "Needs attention",
  starting: "Starting…",
};

function StatusOrb() {
  const appState = useAgentStore((s) => s.appState);
  const status = getSessionStatus(appState);
  return (
    <Tooltip>
      <TooltipTrigger
        // Status only — not interactive. Rendered as a div so it never reads
        // as a button to the user or to assistive tech.
        render={<div />}
        aria-label={`Status: ${ORB_LABEL[status]}`}
        className="flex size-9 items-center justify-center"
      >
        <span
          className={cn(
            "size-6 rounded-full bg-gradient-to-br shadow-inner",
            "shadow-white/40 ring-1 ring-white/30",
            ORB_GRADIENT[status],
          )}
        />
      </TooltipTrigger>
      <TooltipContent side="right">{ORB_LABEL[status]}</TooltipContent>
    </Tooltip>
  );
}

type DockButtonProps = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  active?: boolean;
};

function DockButton({ icon: Icon, label, onClick, active }: DockButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        aria-label={label}
        className={cn(
          "flex size-9 items-center justify-center rounded-xl transition-colors",
          active
            ? "bg-foreground/15 text-foreground"
            : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
        )}
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function launchWidget(widgetId: string): void {
  // placeWidget rejects when the renderer flush of an existing singleton's
  // pending state didn't persist — surface that to the user instead of
  // letting it land as an unhandled promise rejection.
  getBridge()
    ?.placeWidget(widgetId)
    .catch((err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't open the widget");
    });
}

export function LeftDock() {
  const instances = useShellStore((s) => s.instances);
  const placedWidgetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const i of instances) {
      ids.add(i.widgetId);
    }
    return ids;
  }, [instances]);

  return (
    <div className="pointer-events-auto fixed top-1/2 left-4 z-30 -translate-y-1/2">
      <TooltipProvider>
        <div className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card/70 px-1.5 py-2 shadow-xl backdrop-blur-md">
          <StatusOrb />

          <span className="my-1 h-px w-5 bg-border" />

          {BUILTIN_DEFS.map((def) => (
            <DockButton
              key={def.id}
              icon={BUILTIN_WIDGET_UI[def.id].icon}
              label={def.title}
              active={placedWidgetIds.has(def.id)}
              onClick={() => launchWidget(def.id)}
            />
          ))}
        </div>
      </TooltipProvider>
    </div>
  );
}
