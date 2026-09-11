import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";

// One fold header for the panel's Metadata tab: the chevron, the uppercase label and an
// optional summary beside it. The body mounts only while open, since unfolding is what starts
// the reads behind some sections.
export const FoldSection = ({
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
}) => (
  <div className="flex shrink-0 flex-col border-b border-line">
    <button
      type="button"
      aria-expanded={open}
      className="flex w-full min-w-0 items-center gap-1 px-3 py-1.5 text-caption font-medium text-muted-foreground uppercase hover:text-foreground"
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
    {open ? children : null}
  </div>
);
