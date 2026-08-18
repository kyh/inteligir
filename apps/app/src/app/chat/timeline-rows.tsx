// Compact renderers for the projection's row model: conversation rows as
// the chat surface, a turn's work rows (reasoning, commands, file changes,
// plans, tools) as quiet one-liners that expand on demand via <details> —
// no per-row state to manage, and closed is the restrained default.

import type { ViewContext } from "@repo/domain/view-context";
import type {
  TimelineRow,
  TimelineTurnRow,
  TimelineWorkRow,
} from "@repo/server-contract/thread-timeline";
import { Spinner } from "@repo/ui/components/spinner";
import { cn } from "@repo/ui/lib/utils";
import { memo } from "react";

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

/**
 * What the agent was told about the user's screen, under the user's own
 * bubble. It is ATTRIBUTION, not message body — the bubble above stays exactly
 * what was typed — and it exists because a message the model answers with
 * hidden context is a message the user cannot debug.
 */
function ViewContextAttribution({ context }: { context: ViewContext }) {
  const selected = context.selection;
  return (
    <div className="max-w-[85%] truncate px-3 text-xs text-muted-foreground">
      {context.resource}
      {selected === undefined ? null : ` · “${firstLine(selected.text)}”`}
    </div>
  );
}

function WorkRowView({ row }: { row: TimelineWorkRow }) {
  switch (row.workKind) {
    case "reasoning":
      if (row.text.trim() === "") {
        return null;
      }
      return (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none truncate italic">
            {firstLine(row.text)}
          </summary>
          <div className="mt-1 whitespace-pre-wrap pl-3">{row.text}</div>
        </details>
      );
    case "command":
      return (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none truncate font-mono">
            $ {firstLine(row.command)}
            {row.exitCode !== null && row.exitCode !== 0 ? (
              <span className="ml-2 text-destructive">exit {row.exitCode}</span>
            ) : null}
          </summary>
          {row.output.trim() !== "" ? (
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap pl-3 font-mono">
              {row.output}
            </pre>
          ) : null}
        </details>
      );
    case "file-change":
      return (
        <div className="text-xs text-muted-foreground">
          {row.changes.map((change) => (
            <div key={`${change.kind}:${change.path}`} className="truncate font-mono">
              {change.kind === "delete" ? "−" : change.kind === "add" ? "+" : "±"} {change.path}
              {change.movePath !== null ? ` → ${change.movePath}` : ""}
            </div>
          ))}
        </div>
      );
    case "plan":
      if (row.text.trim() === "") {
        return null;
      }
      return (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none truncate">
            Plan: {firstLine(row.text)}
          </summary>
          <div className="mt-1 whitespace-pre-wrap pl-3">{row.text}</div>
        </details>
      );
    case "tool":
      return (
        <div className="truncate font-mono text-xs text-muted-foreground">
          {row.toolName}
          {row.error !== null ? <span className="ml-2 text-destructive">{row.error}</span> : null}
        </div>
      );
  }
}

function TurnRowView({ row }: { row: TimelineTurnRow }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-l border-border/60 pl-3",
        row.status === "error" && "border-destructive/40",
      )}
    >
      {row.children.map((child) => (
        <TimelineRowView key={child.id} row={child} />
      ))}
      {row.status === "pending" ? <Spinner className="size-3 text-muted-foreground" /> : null}
      {row.status === "interrupted" ? (
        <div className="text-xs text-muted-foreground">Interrupted</div>
      ) : null}
    </div>
  );
}

/**
 * Memoized on `row` alone, which is what the delta path already preserves: an
 * unchanged row comes back from `applyTimelineDelta` as the SAME object, so a
 * streaming turn re-rendering every row it did not touch was throwing that
 * identity away — and a turn row carries its whole subtree.
 */
export const TimelineRowView = memo(function TimelineRowView({ row }: { row: TimelineRow }) {
  switch (row.kind) {
    case "conversation":
      if (row.role === "user") {
        return (
          <div className="flex flex-col items-end gap-0.5">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-muted px-3 py-1.5 text-sm">
              {row.text}
            </div>
            {row.viewContext === null ? null : <ViewContextAttribution context={row.viewContext} />}
          </div>
        );
      }
      return <div className="whitespace-pre-wrap text-sm">{row.text}</div>;
    case "error":
      return (
        <div className="text-xs text-destructive">
          {row.message}
          {row.detail !== null ? <span className="opacity-70"> — {row.detail}</span> : null}
        </div>
      );
    case "turn":
      return <TurnRowView row={row} />;
    case "work":
      return <WorkRowView row={row} />;
  }
});
