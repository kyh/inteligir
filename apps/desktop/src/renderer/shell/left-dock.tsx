import { useMemo } from "react";

import { cn } from "@repo/ui/lib/utils";
import { toast } from "@repo/ui/components/sonner";
import { GeometricOrb, type DisplayStatus } from "@repo/ui/components/geometric-orb";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/components/tooltip";
import { BUILTIN_WIDGET_UI } from "@/renderer/shell/builtin-widgets";
import { getBridge } from "@/renderer/lib/bridge";
import { useTheme } from "@/renderer/lib/use-theme";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useShellStore } from "@/renderer/stores/shell-store";
import { getSessionStatus, type SessionStatus } from "@/shared/agent";
import { BUILTIN_DEFS } from "@/shared/shell";

// The left dock is the vertical launcher for built-in widget panels. Chat
// input and voice now live in the BottomDock; custom (JSON-UI) widgets live in
// the Widgets panel — so this stays fixed-size no matter what's installed.

// SessionStatus and GeometricOrb's DisplayStatus overlap exactly today; spell
// the mapping out so a future SessionStatus addition fails the typechecker
// instead of falling through to "starting".
const SESSION_TO_ORB_STATUS: Record<SessionStatus, DisplayStatus> = {
  idle: "idle",
  busy: "busy",
  error: "error",
  starting: "starting",
};

const ORB_LABEL: Record<SessionStatus, string> = {
  idle: "Ready",
  busy: "Working…",
  error: "Needs attention",
  starting: "Starting…",
};

/**
 * Status-only indicator at the top of the dock. Mounts the shared GeometricOrb
 * at 24px so the dock telegraphs agent status with the same visual the
 * pre-shell surfaces (login/onboarding) use — one orb across the whole app
 * instead of a gradient swatch in the shell and a real orb everywhere else.
 */
function StatusOrb() {
  const appState = useAgentStore((s) => s.appState);
  const status = getSessionStatus(appState);
  const { resolved } = useTheme();
  return (
    <Tooltip>
      <TooltipTrigger
        // Status only — not interactive. Rendered as a div so it never reads
        // as a button to the user or to assistive tech.
        render={<div />}
        aria-label={`Status: ${ORB_LABEL[status]}`}
        className="flex size-10 items-center justify-center"
      >
        <div className={cn("size-9 overflow-hidden rounded-full")}>
          <GeometricOrb
            status={SESSION_TO_ORB_STATUS[status]}
            baseColor={resolved === "dark" ? "#eeeeee" : "#f8f8f8"}
            // Hero uses 20 strands × 2px on a 176px canvas (≈23% coverage).
            // At 36px we cut both numbers proportionally so individual
            // strands stay visible instead of saturating into a white disc.
            numLines={8}
            lineWidth={1}
            className="h-full w-full"
          />
        </div>
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
        // Circular slots in the mist-frosted bar: a solid white disc marks the
        // active widget in light theme; dark frost gets a translucent lift.
        className={cn(
          "flex size-9 items-center justify-center rounded-[10px] transition-colors",
          active
            ? "bg-white/10 text-white/90"
            : "text-white/35 hover:bg-white/5 hover:text-white/80",
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
    ?.placeWidget({ widgetId })
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
    <div className="pointer-events-auto fixed top-1/2 left-6 z-30 -translate-y-1/2">
      <TooltipProvider>
        <div className="glass-mist flex flex-col items-center gap-1.5 rounded-[var(--radius-dock)] border border-[rgba(0,0,0,0.05)] px-1 py-2">
          <StatusOrb />

          <span className="my-0.5 h-px w-5 bg-white/12" />

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
