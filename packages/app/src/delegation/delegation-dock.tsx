import { useEffect, useState } from "react";
import {
  CheckCircle2Icon,
  ClockIcon,
  Loader2Icon,
  SquareIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";

import { Response } from "@repo/ui/components/ai-elements/response";
import { cn } from "@repo/ui/lib/utils";

import { useDelegationStore } from "../stores/delegation-store";
import type { Delegation } from "@repo/core/delegation";

/**
 * A Messenger-style dock of delegation cards pinned bottom-right. Each card
 * shows a delegated checkbox's status and the background agent's response,
 * streaming live while it runs. Only delegations that became active during this
 * session are shown (so old finished ones don't reappear on load), and each
 * lingers after finishing until dismissed — the box itself is checked by the
 * agent, so the card is purely the "what did it do" readout.
 */
export function DelegationDock() {
  const delegations = useDelegationStore((s) => s.delegations);
  const streams = useDelegationStore((s) => s.streams);
  const cancel = useDelegationStore((s) => s.cancel);
  const [tracked, setTracked] = useState<ReadonlySet<string>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  // Track any delegation we've seen go active this session.
  useEffect(() => {
    const active = delegations
      .filter((d) => d.status === "queued" || d.status === "running")
      .map((d) => d.id)
      .filter((id) => !tracked.has(id));
    if (active.length > 0) {
      setTracked((prev) => {
        const next = new Set(prev);
        for (const id of active) next.add(id);
        return next;
      });
    }
  }, [delegations, tracked]);

  const visible = delegations
    .filter((d) => tracked.has(d.id) && !dismissed.has(d.id))
    .toSorted((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3);

  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute right-4 bottom-4 z-40 flex w-80 flex-col gap-2">
      {visible.map((d) => (
        <DelegationCard
          key={d.id}
          delegation={d}
          stream={streams[d.id] ?? null}
          onStop={() => cancel(d.id)}
          onDismiss={() =>
            setDismissed((prev) => {
              const next = new Set(prev);
              next.add(d.id);
              return next;
            })
          }
        />
      ))}
    </div>
  );
}

function StatusIcon({ status }: { status: Delegation["status"] }) {
  switch (status) {
    case "queued":
      return <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    case "running":
      return <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" />;
    case "done":
      return <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-600" />;
    case "failed":
      return <XCircleIcon className="size-3.5 shrink-0 text-destructive" />;
  }
}

function DelegationCard({
  delegation,
  stream,
  onStop,
  onDismiss,
}: {
  delegation: Delegation;
  stream: string | null;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const { status, anchor, resultSummary, error } = delegation;
  const active = status === "running" || status === "queued";
  // Prefer the live stream while running; fall back to the persisted summary.
  const body = error ?? stream ?? resultSummary ?? "";

  return (
    <div className="pointer-events-auto flex max-h-72 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <StatusIcon status={status} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={anchor.text}>
          {anchor.text}
        </span>
        {active ? (
          <button
            type="button"
            onClick={onStop}
            title="Stop"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            <SquareIcon className="size-3 fill-current" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onDismiss}
            title="Dismiss"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
      {body.length > 0 && (
        <div className="min-h-0 overflow-y-auto px-3 py-2 text-xs leading-relaxed select-text">
          {status === "failed" ? (
            <span className="text-destructive">{body}</span>
          ) : (
            <Response className={cn("prose-sm")}>{body}</Response>
          )}
        </div>
      )}
    </div>
  );
}
