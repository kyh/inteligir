// The one delegation status badge + Delegate affordance, shared by the
// editor's checkbox control (todo-delegation) and the tasks-view rows (#451).
// The tasks surface never renders "done" — its type-level ActiveDelegation
// pre-filter drops finished delegations because the checked box is the durable
// done signal there; `compact` is the list-row sizing delta.

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  Loader2Icon,
  RotateCwIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";

import type { Delegation } from "@repo/bridge/delegation";

export function DelegationStatusBadge({
  delegation,
  onCancel,
  onRetry,
  compact = false,
}: {
  delegation: Delegation;
  onCancel: () => void;
  onRetry: () => void;
  /** List-row sizing: the pill refuses to shrink in a flex row (tasks view). */
  compact?: boolean;
}) {
  const pill = (extra: string) =>
    cn(
      "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]",
      compact && "shrink-0",
      extra,
    );
  switch (delegation.status) {
    case "queued":
      return (
        <span className={pill("bg-muted text-muted-foreground")}>
          <Clock3Icon className="size-3" />
          Queued
          <button
            type="button"
            aria-label="Cancel delegation"
            onClick={onCancel}
            title="Cancel"
            className="hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      );
    case "running":
      return (
        <span className={pill("bg-primary/10 text-primary")}>
          <Loader2Icon className="size-3 animate-spin" />
          Working…
        </span>
      );
    case "done":
      return (
        <span
          className={pill("text-emerald-600 dark:text-emerald-400")}
          title={delegation.resultSummary ?? "Done"}
        >
          <CheckCircle2Icon className="size-3" />
          Done
        </span>
      );
    case "failed":
      return (
        <span className={pill("text-destructive")} title={delegation.error ?? "Failed"}>
          <AlertCircleIcon className="size-3" />
          Failed
          <button
            type="button"
            aria-label="Retry delegation"
            onClick={onRetry}
            title="Retry delegation"
            className="hover:text-foreground"
          >
            <RotateCwIcon className="size-3" />
          </button>
        </span>
      );
  }
}

/** The hover-revealed "Delegate" ghost button both surfaces pair with the badge. */
export function DelegateButton({
  onClick,
  compact = false,
}: {
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={onClick}
      title="Delegate this task to an agent"
      className={cn(
        "h-auto rounded-full px-2 py-0.5 text-[10px] font-normal text-muted-foreground opacity-0 group-hover:opacity-100",
        compact && "shrink-0",
      )}
    >
      <SparklesIcon className="size-3" />
      Delegate
    </Button>
  );
}
