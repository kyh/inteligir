import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible";
import { cn } from "@repo/ui/lib/utils";

import type { ToolExecution } from "@/renderer/stores/agent-store";

const statusIndicator: Record<ToolExecution["status"], string> = {
  running: "animate-pulse text-yellow-400",
  done: "text-green-400",
  error: "text-red-400",
};

const statusIcon: Record<ToolExecution["status"], string> = {
  running: "◌",
  done: "✓",
  error: "✗",
};

export function ToolExecutionView({ execution }: { execution: ToolExecution }) {
  const [open, setOpen] = useState(false);
  const hasResult = execution.resultText.length > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs font-mono",
          "text-muted-foreground hover:bg-secondary/50 transition-colors",
          hasResult && "cursor-pointer",
        )}
        disabled={!hasResult}
      >
        <span className={cn("shrink-0", statusIndicator[execution.status])}>
          {statusIcon[execution.status]}
        </span>
        <span className="truncate">{execution.toolName}</span>
        {hasResult && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
            {open ? "▾" : "▸"}
          </span>
        )}
      </CollapsibleTrigger>
      {hasResult && (
        <CollapsibleContent>
          <pre className="mt-1 max-h-60 overflow-auto rounded bg-secondary/50 p-2 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
            {execution.resultText}
          </pre>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
