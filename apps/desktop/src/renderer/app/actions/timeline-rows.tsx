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
import { Badge } from "@repo/ui/components/badge";
import { cn } from "@repo/ui/lib/cn";
import { plural } from "@repo/ui/lib/plural";
import { FileTextIcon } from "lucide-react";
import { memo } from "react";
import type { ReactNode } from "react";

const CHANGE_MARKS = {
  add: "+",
  delete: "−",
  update: "±",
} satisfies Record<TimelineFileChange["kind"], string>;

const firstLine = (text: string): string => text.split("\n", 1)[0] ?? "";

const ViewContextAttribution = ({ context }: { context: ViewContext }) => (
  <div className="max-w-[85%] truncate px-3 text-body text-muted-foreground">
    {context.resource}
  </div>
);

const ContextPathChips = ({ paths }: { paths: readonly string[] }) => (
  <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
    {paths.map((path) => (
      <Badge key={path} variant="outline" className="gap-1 bg-surface-raised">
        <FileTextIcon className="size-3" />
        {path}
      </Badge>
    ))}
  </div>
);

const isThought = (row: TimelineRow): boolean =>
  row.kind === "work" && (row.workKind === "reasoning" || row.workKind === "plan");

const isAction = (row: TimelineRow): boolean =>
  row.kind === "work" &&
  (row.workKind === "command" || row.workKind === "file-change" || row.workKind === "tool");

const ThoughtRowContent = ({ row }: { row: TimelineWorkRow }): ReactNode => {
  if (row.workKind === "reasoning") {
    return row.text.trim() === "" ? null : (
      <ThinkingReasoning pending={row.status === "pending"}>
        {firstLine(row.text)}
      </ThinkingReasoning>
    );
  }
  if (row.workKind === "plan") {
    return row.text.trim() === "" ? null : (
      <ThinkingStep pending={row.status === "pending"}>Plan: {firstLine(row.text)}</ThinkingStep>
    );
  }
  return null;
};

const ActionChipContent = ({ row }: { row: TimelineWorkRow }): ReactNode => {
  switch (row.workKind) {
    case "command": {
      const failed = row.exitCode !== null && row.exitCode !== 0;
      const lines = row.outputHead.map((line, index) => (
        <ToolChipDetail key={`${row.id}:${String(index)}`}>{line}</ToolChipDetail>
      ));
      const unshown = row.outputLineCount - row.outputHead.length;
      if (unshown > 0) {
        lines.push(
          <ToolChipDetail key={`${row.id}:more`} className="font-sans text-ink-3">
            {plural(unshown, "more line")}
          </ToolChipDetail>,
        );
      }
      return (
        <ToolChip
          icon="run"
          label={failed ? `Ran a command — exit ${String(row.exitCode)}` : "Ran a command"}
          chip={firstLine(row.command)}
          mono
          detailMono
        >
          {lines}
        </ToolChip>
      );
    }
    case "file-change": {
      const [first] = row.changes;
      return (
        <ToolChip
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

// memoized on `row` like the rows that hold them: a patched turn keeps every child it did not carry
const ThoughtRow = memo(ThoughtRowContent);
const ActionChip = memo(ActionChipContent);

const ErrorRowView = ({ row }: { row: TimelineErrorRow }) => (
  <div className="text-body text-destructive">
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
        <Thinking working={working} doneLabel={plural(thoughts.length, "thought")}>
          {thoughts.map((child) =>
            child.kind === "work" ? <ThoughtRow key={child.id} row={child} /> : null,
          )}
        </Thinking>
      )}
      {actions.length === 0 ? null : (
        <ToolChipList summary={plural(actions.length, "tool call")} defaultExpanded={false}>
          {actions.map((child) =>
            child.kind === "work" ? <ActionChip key={child.id} row={child} /> : null,
          )}
        </ToolChipList>
      )}
      {errors.map((child) => (
        <ErrorRowView key={child.id} row={child} />
      ))}
      {working ? <LoadingState label="Working" startedAt={row.createdAt} /> : null}
      {row.status === "interrupted" ? (
        <div className="text-body text-muted-foreground">Interrupted</div>
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
            <div className="max-w-[85%] rounded-2xl bg-surface-raised px-3 py-1.5 text-subtitle whitespace-pre-wrap shadow-surface-1">
              {row.text}
            </div>
            {row.contextPaths.length === 0 ? null : <ContextPathChips paths={row.contextPaths} />}
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

// memoized on `row`: `applyTimelineDelta` preserves untouched rows' identity, and a patched turn its untouched children's.
export const TimelineRowView = memo(TimelineRowContent);

// the user bubble's shape, unfilled: the reply waits in the thread's queue, not yet in its events.
export const QueuedReplyView = ({ text }: { text: string }) => (
  <div className="flex flex-col items-end gap-0.5">
    <div className="max-w-[85%] rounded-2xl border border-dashed border-line px-3 py-1.5 text-subtitle whitespace-pre-wrap text-muted-foreground">
      {text}
    </div>
    <div className="px-3 text-caption text-muted-foreground">Queued</div>
  </div>
);
