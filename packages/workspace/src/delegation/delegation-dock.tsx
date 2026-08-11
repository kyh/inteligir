import { useState } from "react";
import {
  CheckCircle2Icon,
  ClockIcon,
  Loader2Icon,
  SquareIcon,
  Undo2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog";
import { Spinner } from "@repo/ui/components/spinner";
import { Response } from "@repo/workspace/ai-elements/response";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";

import { useDelegationStore } from "@repo/editor/stores/delegation-store";
import { useVaultListing } from "@repo/editor/host";
import type { Delegation } from "@repo/bridge/delegation";

/** The ids of every delegation currently queued or running. */
function activeIds(delegations: readonly Delegation[]): string[] {
  return delegations
    .filter((d) => d.status === "queued" || d.status === "running")
    .map((d) => d.id);
}

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
  const restore = useDelegationStore((s) => s.restore);
  const { entries } = useVaultListing();
  // Every delegation we've seen go active this session. Seeded from whatever is
  // already active at mount, then grown by the render-time adjustment below.
  const [tracked, setTracked] = useState<ReadonlySet<string>>(
    () => new Set(activeIds(delegations)),
  );
  const [seenDelegations, setSeenDelegations] = useState(delegations);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  // The delegation awaiting restore confirmation (null = dialog closed).
  const [confirming, setConfirming] = useState<Delegation | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Grow `tracked` DURING render off a previous-value comparison (react.dev,
  // "Adjusting some state when a prop changes") rather than from an Effect. The
  // Effect this replaces both read and wrote `tracked` and listed it in its own
  // deps, so every newly-active delegation cost an extra render pair. React
  // re-runs this render immediately with the new state — no commit, no paint.
  if (delegations !== seenDelegations) {
    setSeenDelegations(delegations);
    const newlyActive = activeIds(delegations).filter((id) => !tracked.has(id));
    if (newlyActive.length > 0) setTracked((prev) => new Set([...prev, ...newlyActive]));
  }

  const confirmRestore = async () => {
    if (!confirming) return;
    setRestoring(true);
    const result = await restore(confirming.id);
    setRestoring(false);
    setConfirming(null);
    if (!result.ok) toast.error(result.error ?? "Couldn't restore the snapshot.");
  };

  const visible = delegations
    .filter((d) => tracked.has(d.id) && !dismissed.has(d.id))
    .toSorted((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3);

  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute right-4 bottom-9 z-40 flex w-80 flex-col gap-2">
      {visible.map((d) => (
        <DelegationCard
          key={d.id}
          delegation={d}
          stream={streams[d.id] ?? null}
          fileExists={entries.some((entry) => entry.path === d.sourceFile)}
          onStop={() => cancel(d.id)}
          onRestore={() => setConfirming(d)}
          onDismiss={() =>
            setDismissed((prev) => {
              const next = new Set(prev);
              next.add(d.id);
              return next;
            })
          }
        />
      ))}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !restoring) setConfirming(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore original?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            This overwrites the current content of {confirming?.sourceFile ?? "the file"} with the
            copy saved before the agent ran.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <Button variant="secondary" disabled={restoring} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button disabled={restoring} onClick={() => void confirmRestore()}>
              {restoring && <Spinner />}
              Restore
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  fileExists,
  onStop,
  onRestore,
  onDismiss,
}: {
  delegation: Delegation;
  stream: string | null;
  fileExists: boolean;
  onStop: () => void;
  onRestore: () => void;
  onDismiss: () => void;
}) {
  const { status, anchor, resultSummary, error, hasSnapshot, restoredAt } = delegation;
  const active = status === "running" || status === "queued";
  // Prefer the live stream while running; fall back to the persisted summary.
  const body = error ?? stream ?? resultSummary ?? "";
  // Undo affordance: only once the run is over (restoring under a live run
  // would race the agent) and only when a pre-run snapshot was captured.
  const restorable = !active && hasSnapshot;

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
            aria-label="Dismiss delegation"
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
            <Response className="typeset typeset-chat">{body}</Response>
          )}
        </div>
      )}
      {restorable && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-1.5">
          <button
            type="button"
            onClick={onRestore}
            disabled={!fileExists}
            title={
              fileExists
                ? `Overwrite ${delegation.sourceFile} with its pre-run content`
                : `${delegation.sourceFile} no longer exists`
            }
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <Undo2Icon className="size-3" />
            Restore original
          </button>
          {restoredAt !== null && (
            <span className="text-[10px] text-muted-foreground">Restored</span>
          )}
        </div>
      )}
    </div>
  );
}
