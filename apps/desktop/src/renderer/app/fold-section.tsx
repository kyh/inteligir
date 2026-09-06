import { cn } from "@repo/ui/lib/utils";
import { ChevronRightIcon } from "lucide-react";

// One fold header for the rail's sections and the panel's Metadata tab: the chevron, the
// uppercase label, an optional summary beside it and optional actions at the right edge, shown
// on hover or focus. The body mounts only while open, since unfolding is what starts the reads
// behind some sections. A `fill` section takes a share of its column and hands its children the
// column to scroll in.
export function FoldSection({
  label,
  summary,
  actions,
  open,
  onOpenChange,
  fill = false,
  children,
}: {
  label: string;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col border-b border-line",
        fill && open ? "min-h-0 flex-1" : "shrink-0",
      )}
    >
      <div className="group flex shrink-0 items-center pr-1">
        <button
          type="button"
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase hover:text-foreground"
          onClick={() => {
            onOpenChange(!open);
          }}
        >
          <ChevronRightIcon
            className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
          />
          <span className="truncate">{label}</span>
          {summary === undefined ? null : (
            <span className="font-normal tabular-nums normal-case">{summary}</span>
          )}
        </button>
        {actions === undefined ? null : (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            {actions}
          </div>
        )}
      </div>
      {!open ? null : fill ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
