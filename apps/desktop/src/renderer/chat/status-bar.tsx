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

export function StatusBar() {
  const sessionStatus = useAgentStore((s) => s.sessionStatus);

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border px-6 py-1.5 text-[11px] font-mono text-muted-foreground">
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
