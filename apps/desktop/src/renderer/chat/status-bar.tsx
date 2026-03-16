import { cn } from "@repo/ui/utils";

import type { SessionStatus } from "@/shared/agent";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { TaskPanel } from "@/renderer/chat/task-panel";

const statusColors: Record<SessionStatus, string> = {
  idle: "bg-green-400",
  busy: "bg-yellow-400 animate-pulse",
  error: "bg-red-400",
  starting: "bg-blue-400 animate-pulse",
};

function useSessionStatus(): SessionStatus {
  const appState = useAgentStore((s) => s.appState);
  if (appState.phase === "ready") return appState.agent === "busy" ? "busy" : "idle";
  if (appState.phase === "error") return "error";
  return "starting";
}

export function StatusBar() {
  const sessionStatus = useSessionStatus();

  return (
    <div className="text-muted-foreground flex items-center gap-3 px-1 pt-1.5 font-mono text-[11px]">
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          statusColors[sessionStatus],
        )}
        title={sessionStatus}
      />
      <span>{sessionStatus}</span>
      <span className="text-border">|</span>
      <TaskPanel />
    </div>
  );
}
