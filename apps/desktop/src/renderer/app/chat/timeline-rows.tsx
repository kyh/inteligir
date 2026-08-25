// The projection's row model rendered through the vendored AI surface
// (@repo/ui/ai): a turn's quiet work splits by what a reader is asking of it —
// reasoning and plans compose a THINKING trace, commands, tools and file
// changes compose TOOL CHIPS — while conversation rows stay the chat surface
// and a turn still in flight carries the loader.

import type { ViewContext } from "@repo/domain/view-context";
import type {
  TimelineFileChange,
  TimelineRow,
  TimelineTurnRow,
  TimelineWorkRow,
} from "@repo/api/local/thread-timeline";
import { LoadingState } from "@repo/ui/ai/loading-state";
import { StreamingText } from "@repo/ui/ai/streaming-text";
import { Thinking, ThinkingReasoning, ThinkingStep } from "@repo/ui/ai/thinking";
import { ToolChip, ToolChipDetail, ToolChipList } from "@repo/ui/ai/tool-chips";
import { cn } from "@repo/ui/lib/utils";
import { memo, type ReactNode } from "react";

/** A command's output is a transcript, not a document: the chip carries the
 *  head of it so a long build log cannot push the turn off screen. */
const COMMAND_OUTPUT_LINES = 40;

const CHANGE_MARKS = {
  add: "+",
  delete: "−",
  update: "±",
} satisfies Record<TimelineFileChange["kind"], string>;

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

function isThought(row: TimelineRow): boolean {
  return row.kind === "work" && (row.workKind === "reasoning" || row.workKind === "plan");
}

function isAction(row: TimelineRow): boolean {
  return (
    row.kind === "work" &&
    (row.workKind === "command" || row.workKind === "file-change" || row.workKind === "tool")
  );
}

/** Reasoning and plans: what the agent was working out. */
function thoughtRow(row: TimelineWorkRow): ReactNode {
  if (row.workKind === "reasoning") {
    return row.text.trim() === "" ? null : (
      <ThinkingReasoning key={row.id} pending={row.status === "pending"}>
        {firstLine(row.text)}
      </ThinkingReasoning>
    );
  }
  if (row.workKind === "plan") {
    return row.text.trim() === "" ? null : (
      <ThinkingStep key={row.id} pending={row.status === "pending"}>
        Plan: {firstLine(row.text)}
      </ThinkingStep>
    );
  }
  return null;
}

/** Commands, tools and file changes: what the agent DID. */
function actionChip(row: TimelineWorkRow): ReactNode {
  switch (row.workKind) {
    case "command": {
      const failed = row.exitCode !== null && row.exitCode !== 0;
      const output =
        row.output.trim() === "" ? [] : row.output.split("\n").slice(0, COMMAND_OUTPUT_LINES);
      return (
        <ToolChip
          key={row.id}
          icon="run"
          label={failed ? `Ran a command — exit ${String(row.exitCode)}` : "Ran a command"}
          chip={firstLine(row.command)}
          mono
          detailMono
        >
          {output.map((line, index) => (
            <ToolChipDetail key={`${row.id}:${String(index)}`}>{line}</ToolChipDetail>
          ))}
        </ToolChip>
      );
    }
    case "file-change": {
      const [first] = row.changes;
      return (
        <ToolChip
          key={row.id}
          icon="write"
          label={
            row.changes.length > 1 ? `Edited ${String(row.changes.length)} files` : "Edited a file"
          }
          chip={first === undefined ? "no changes" : first.path}
          mono
          detailMono
        >
          {row.changes.map((change) => (
            <ToolChipDetail
              key={`${change.kind}:${change.path}`}
              {...(change.kind === "add" ? { tone: "add" as const } : {})}
            >
              {CHANGE_MARKS[change.kind]} {change.path}
              {change.movePath === null ? "" : ` → ${change.movePath}`}
            </ToolChipDetail>
          ))}
        </ToolChip>
      );
    }
    case "tool":
      return (
        <ToolChip
          key={row.id}
          icon={row.error === null ? "think" : "read"}
          label={row.error === null ? "Called a tool" : "Tool failed"}
          chip={row.toolName}
          mono
        >
          {row.error === null ? null : <ToolChipDetail>{row.error}</ToolChipDetail>}
        </ToolChip>
      );
    case "reasoning":
    case "plan":
      return null;
  }
}

function countLabel(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

function TurnRowView({ row }: { row: TimelineTurnRow }) {
  const thoughts = row.children.filter(isThought);
  const actions = row.children.filter(isAction);
  const errors = row.children.filter((child) => child.kind === "error");
  const working = row.status === "pending";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-l border-border/60 pl-3",
        row.status === "error" && "border-destructive/40",
      )}
    >
      {thoughts.length === 0 ? null : (
        <Thinking working={working} doneLabel={countLabel(thoughts.length, "thought", "thoughts")}>
          {thoughts.map((child) => (child.kind === "work" ? thoughtRow(child) : null))}
        </Thinking>
      )}
      {actions.length === 0 ? null : (
        <ToolChipList
          summary={countLabel(actions.length, "tool call", "tool calls")}
          defaultExpanded={false}
        >
          {actions.map((child) => (child.kind === "work" ? actionChip(child) : null))}
        </ToolChipList>
      )}
      {errors.map((child) => (
        <TimelineRowView key={child.id} row={child} />
      ))}
      {working ? (
        // The turn's own createdAt, so a panel opened onto a running turn
        // shows its true age rather than restarting the clock at mount.
        <LoadingState label="Working" startedAt={row.createdAt} />
      ) : null}
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
            <div className="max-w-[85%] rounded-2xl bg-surface-raised px-3 py-1.5 text-sm whitespace-pre-wrap shadow-surface-1">
              {row.text}
            </div>
            {row.viewContext === null ? null : <ViewContextAttribution context={row.viewContext} />}
          </div>
        );
      }
      // `animate` stays OFF: our text is ALREADY live — the projection grows
      // this row per provider delta — so the component's 55ms-per-word reveal
      // would lag a real stream and keep trailing after the turn finished.
      // The turn's own loader is the "still working" signal.
      return <StreamingText text={row.text} animate={false} />;
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
      // Work rows render INSIDE their turn, composed into the thinking trace
      // or the tool chips; a stray one (its turn never started) has no surface.
      return null;
  }
});
