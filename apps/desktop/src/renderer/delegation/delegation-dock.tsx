import { useState } from "react";
import { CheckIcon, ChevronDownIcon, SquareIcon, Undo2Icon, XIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog";
import { Spinner } from "@repo/ui/components/spinner";
import { cn } from "@repo/ui/lib/utils";
import { Response } from "@renderer/ai-elements/response";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";

import { useDelegationStore } from "@renderer/stores/delegation-store";
import { useVaultListing } from "@renderer/workspace/vault-context";
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
    // Wider than the old w-80 (320px): a task row carries badge, label, file,
    // pill and two controls on one line, and at 320px the label truncated to a
    // few characters. 27rem is the reference's own row width.
    <div className="pointer-events-none absolute right-4 bottom-4 z-40 flex w-[27rem] flex-col gap-2">
      {visible.map((d, i) => (
        <DelegationRow
          key={d.id}
          delegation={d}
          stream={streams[d.id] ?? null}
          fileExists={entries.some((entry) => entry.path === d.sourceFile)}
          // Position among the rows on screen, oldest-first, so the ring's
          // number reads as "step N of what's in flight" like the reference.
          queuePosition={visible.length - i}
          index={i}
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

/** Radius of a collapsed row vs an expanded one. A capsule that squares off as
 * it opens is the reference's tell that the row became a panel; the transition
 * between the two is what sells it, so both live here as one pair. */
const ROW_RADIUS_COLLAPSED = 22;
const ROW_RADIUS_EXPANDED = 14;

/**
 * A step ring — the pre-completion badge. Queued rows show a static ring
 * carrying their place in the queue; a running row spins a 28%-arc over it.
 * Geometry follows the reference: r=11 in a 24px box, so the stroke sits a
 * pixel inside the badge slot.
 */
function StepRing({ active, children }: { active: boolean; children: React.ReactNode }) {
  const circumference = 2 * Math.PI * 11;
  return (
    <span className="relative inline-flex size-6 shrink-0 items-center justify-center">
      <svg
        width={24}
        height={24}
        aria-hidden
        className={cn("absolute inset-0", active && "animate-spin")}
      >
        <circle cx={12} cy={12} r={11} fill="none" stroke="var(--ai-line)" strokeWidth={2} />
        {active && (
          <circle
            cx={12}
            cy={12}
            r={11}
            fill="none"
            stroke="var(--ai-ink-3)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={`${0.28 * circumference} ${0.72 * circumference}`}
          />
        )}
      </svg>
      <span className="relative text-[10.5px] font-semibold tabular-nums text-ai-ink">
        {children}
      </span>
    </span>
  );
}

/** The terminal badge — a filled disc that pops in when the run lands. */
function OutcomeDot({ tone, children }: { tone: "green" | "red"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "animate-ai-pop-in flex size-5.5 shrink-0 items-center justify-center rounded-full text-white",
        tone === "red" ? "bg-ai-red" : "bg-ai-green",
      )}
      style={{ animationDuration: "300ms" }}
    >
      {children}
    </span>
  );
}

function StatusBadge({
  status,
  queuePosition,
}: {
  status: Delegation["status"];
  queuePosition: number;
}) {
  switch (status) {
    case "queued":
      return <StepRing active={false}>{queuePosition}</StepRing>;
    case "running":
      return <StepRing active>{queuePosition}</StepRing>;
    case "done":
      return (
        <OutcomeDot tone="green">
          <CheckIcon className="size-3 [stroke-width:3.5]" />
        </OutcomeDot>
      );
    case "failed":
      return (
        <OutcomeDot tone="red">
          <XIcon className="size-3 [stroke-width:3.5]" />
        </OutcomeDot>
      );
  }
}

/** The trailing status pill. Absent while queued — an un-started row's badge
 * already says everything, and a "Queued" pill on every waiting row is noise. */
function StatusPill({ status }: { status: Delegation["status"] }) {
  const pill =
    "animate-ai-fade-in inline-flex h-5.5 items-center rounded-full px-2 text-[11.5px] font-medium";
  switch (status) {
    case "queued":
      return null;
    case "running":
      return <span className={cn(pill, "bg-ai-accent-tint text-ai-accent-ink")}>Running</span>;
    case "done":
      return <span className={cn(pill, "bg-ai-green-tint text-ai-green")}>Completed</span>;
    case "failed":
      return <span className={cn(pill, "bg-ai-red-tint text-ai-red")}>Failed</span>;
  }
}

/** Vault-relative path → the file's own name, the one fact that says which note
 * this row came from without spending the width a full path needs. */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * One task row: a capsule whose header is always legible at a glance — badge,
 * what was delegated, which file, outcome — over a detail region holding the
 * agent's write-up and the row's destructive affordance.
 *
 * A running row opens itself so the reply streams in view; once it lands the row
 * stays open (there is something to read) but a user toggle always wins, which
 * is why `expanded` is a nullable override rather than a plain boolean.
 */
function DelegationRow({
  delegation,
  stream,
  fileExists,
  queuePosition,
  index,
  onStop,
  onRestore,
  onDismiss,
}: {
  delegation: Delegation;
  stream: string | null;
  fileExists: boolean;
  queuePosition: number;
  index: number;
  onStop: () => void;
  onRestore: () => void;
  onDismiss: () => void;
}) {
  const { status, anchor, resultSummary, error, hasSnapshot, restoredAt, sourceFile } = delegation;
  const active = status === "running" || status === "queued";
  // Prefer the live stream while running; fall back to the persisted summary.
  const body = error ?? stream ?? resultSummary ?? "";
  // Undo affordance: only once the run is over (restoring under a live run
  // would race the agent) and only when a pre-run snapshot was captured.
  const restorable = !active && hasSnapshot;
  const [override, setOverride] = useState<boolean | null>(null);
  const hasDetail = body.length > 0 || restorable;
  const expanded = (override ?? status !== "queued") && hasDetail;

  return (
    <div
      className="animate-ai-fade-up pointer-events-auto self-stretch overflow-hidden bg-ai-surface shadow-ai-card transition-[border-radius] duration-300"
      style={{
        borderRadius: expanded ? ROW_RADIUS_EXPANDED : ROW_RADIUS_COLLAPSED,
        animationDelay: `${index * 80}ms`,
      }}
    >
      <div className="flex h-11 items-center gap-2.5 px-2.5">
        <StatusBadge status={status} queuePosition={queuePosition} />
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-ai-ink"
          title={anchor.text}
        >
          {anchor.text}
        </span>
        {/* Capped and truncatable: a long filename must yield room before the
         * label does — what was delegated matters more than where it lives. */}
        <span className="max-w-28 shrink-0 truncate text-[12.5px] text-ai-ink-2" title={sourceFile}>
          {fileName(sourceFile)}
        </span>
        <StatusPill status={status} />
        {active ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop delegation"
            title="Stop"
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-ai-ink-3 transition-colors duration-100 hover:bg-ai-hover hover:text-ai-red"
          >
            <SquareIcon className="size-2.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Dismiss delegation"
            onClick={onDismiss}
            title="Dismiss"
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-ai-ink-3 transition-colors duration-100 hover:bg-ai-hover hover:text-ai-ink"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
        {/* The disclosure is the row itself; it only exists once there is
         * something under it to disclose. */}
        {hasDetail && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "Hide result" : "Show result"}
            onClick={() => setOverride(!expanded)}
            className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-ai-ink-3 transition-colors duration-100 hover:bg-ai-hover hover:text-ai-ink"
          >
            <ChevronDownIcon
              className="size-[15px] transition-transform duration-300"
              style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
            />
          </button>
        )}
      </div>
      {/* 1fr/0fr on a grid row is the height transition that needs no measured
       * pixel height — the reference's own mechanism, so a streaming reply can
       * grow the panel without a layout effect chasing it. */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
            <span aria-hidden className="mx-auto h-full w-px bg-ai-line" />
            <div className="flex min-w-0 flex-col gap-1.5">
              {body.length > 0 && (
                <div className="max-h-56 overflow-y-auto text-[12px] leading-relaxed select-text">
                  {status === "failed" ? (
                    <span className="text-ai-red">{body}</span>
                  ) : (
                    <Response className="typeset typeset-chat text-ai-ink-2">{body}</Response>
                  )}
                </div>
              )}
              {restorable && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onRestore}
                    disabled={!fileExists}
                    title={
                      fileExists
                        ? `Overwrite ${sourceFile} with its pre-run content`
                        : `${sourceFile} no longer exists`
                    }
                    className="flex items-center gap-1 rounded-ai-chip px-1.5 py-0.5 text-[11.5px] font-medium text-ai-ink-2 transition-colors duration-100 hover:bg-ai-hover hover:text-ai-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ai-ink-2"
                  >
                    <Undo2Icon className="size-3" />
                    Restore original
                  </button>
                  {restoredAt !== null && (
                    <span className="text-[11.5px] text-ai-ink-3">Restored</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
