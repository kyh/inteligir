import type { ViewContext } from "@repo/domain/view-context";
import type {
  TimelineErrorRow,
  TimelineFileChange,
  TimelineRow,
  TimelineTurnRow,
  TimelineWorkRow,
} from "@repo/api/local/thread-timeline";
import { LoadingState } from "@repo/ui/ai/loading-state";
import { StreamingText } from "@repo/ui/ai/streaming-text";
import { Thinking, ThinkingReasoning, ThinkingStep } from "@repo/ui/ai/thinking";
import { ToolChip, ToolChipDetail, ToolChipList } from "@repo/ui/ai/tool-chips";
import { cn } from "cn";
import { memo } from "react";
import type { ReactNode } from "react";

const COMMAND_OUTPUT_LINES = 40;

const CHANGE_MARKS = {
  add: "+",
  delete: "−",
  update: "±",
} satisfies Record<TimelineFileChange["kind"], string>;

const firstLine = (text: string): string => text.split("\n", 1)[0] ?? "";

const ViewContextAttribution = ({ context }: { context: ViewContext }) => (
  <div className="max-w-[85%] truncate px-3 text-xs text-muted-foreground">{context.resource}</div>
);

const isThought = (row: TimelineRow): boolean =>
  row.kind === "work" && (row.workKind === "reasoning" || row.workKind === "plan");

const isAction = (row: TimelineRow): boolean =>
  row.kind === "work" &&
  (row.workKind === "command" || row.workKind === "file-change" || row.workKind === "tool");

const thoughtRow = (row: TimelineWorkRow): ReactNode => {
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
};

const actionChip = (row: TimelineWorkRow): ReactNode => {
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
    case "tool": {
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
    }
    case "reasoning":
    case "plan": {
      return null;
    }
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
};

const countLabel = (count: number, one: string, many: string): string =>
  count === 1 ? `1 ${one}` : `${String(count)} ${many}`;

const ErrorRowView = ({ row }: { row: TimelineErrorRow }) => (
  <div className="text-xs text-destructive">
    {row.message}
    {row.detail === null ? null : <span className="opacity-70"> — {row.detail}</span>}
  </div>
);

const TurnRowView = ({ row }: { row: TimelineTurnRow }) => {
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
          {thoughts.map((child): ReactNode => (child.kind === "work" ? thoughtRow(child) : null))}
        </Thinking>
      )}
      {actions.length === 0 ? null : (
        <ToolChipList
          summary={countLabel(actions.length, "tool call", "tool calls")}
          defaultExpanded={false}
        >
          {actions.map((child): ReactNode => (child.kind === "work" ? actionChip(child) : null))}
        </ToolChipList>
      )}
      {errors.map((child) => (
        <ErrorRowView key={child.id} row={child} />
      ))}
      {working ? <LoadingState label="Working" startedAt={row.createdAt} /> : null}
      {row.status === "interrupted" ? (
        <div className="text-xs text-muted-foreground">Interrupted</div>
      ) : null}
    </div>
  );
};

const TimelineRowContent = ({ row }: { row: TimelineRow }) => {
  switch (row.kind) {
    case "conversation": {
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
      // `animate` off: the projection already grows this row per delta, so the per-word reveal would trail the stream.
      return <StreamingText text={row.text} animate={false} />;
    }
    case "error": {
      return <ErrorRowView row={row} />;
    }
    case "turn": {
      return <TurnRowView row={row} />;
    }
    case "work": {
      return null;
    }
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
};

// memoized on `row`: `applyTimelineDelta` preserves untouched rows' identity, and a turn row carries its subtree.
export const TimelineRowView = memo(TimelineRowContent);
