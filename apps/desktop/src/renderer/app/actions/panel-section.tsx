import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";

// One fold header for every section of the panel's Metadata tab: the chevron, the uppercase
// label and an optional summary beside it; the body mounts only while open, since unfolding is
// what starts the reads behind some sections.
export function PanelSection({
  label,
  summary,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  summary?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-muted-foreground uppercase hover:text-foreground"
        onClick={() => {
          onOpenChange(!open);
        }}
      >
        <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
        {label}
        {summary === undefined ? null : (
          <span className="font-normal tabular-nums normal-case">{summary}</span>
        )}
      </button>
      {open ? children : null}
    </div>
  );
}
