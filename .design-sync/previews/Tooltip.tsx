import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Button } from "@repo/ui";
import { Sparkles, Link2, Search } from "lucide-react";

export function DelegateHint() {
  return (
    <TooltipProvider>
      <Tooltip defaultOpen>
        <TooltipTrigger
          render={
            <Button variant="secondary" size="icon" aria-label="Delegate">
              <Sparkles />
            </Button>
          }
        />
        <TooltipContent>Delegate this task to a background agent</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function Sides() {
  return (
    <TooltipProvider>
      <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
        <Tooltip defaultOpen>
          <TooltipTrigger
            render={
              <Button variant="secondary" size="icon" aria-label="Backlinks">
                <Link2 />
              </Button>
            }
          />
          <TooltipContent side="top">Show backlinks</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="secondary" size="icon" aria-label="Search">
                <Search />
              </Button>
            }
          />
          <TooltipContent side="bottom">Search the vault</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
