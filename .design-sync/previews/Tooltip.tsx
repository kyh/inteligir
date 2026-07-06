import { Tooltip, TooltipProvider, Button } from "@repo/ui";
import { Sparkles } from "lucide-react";

export function DelegateHint() {
  return (
    <TooltipProvider>
      <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Tooltip content="Delegate this task to a background agent" side="top" forceOpen>
          <Button size="icon" variant="secondary" aria-label="Delegate">
            <Sparkles />
          </Button>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export function Sides() {
  return (
    <TooltipProvider>
      <div style={{ display: "flex", gap: 56, justifyContent: "center", padding: 56 }}>
        <Tooltip content="Rename" side="top" forceOpen>
          <Button variant="secondary">Top</Button>
        </Tooltip>
        <Tooltip content="Open in new pane" side="bottom" forceOpen>
          <Button variant="secondary">Bottom</Button>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
