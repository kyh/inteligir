import type { ViewContext } from "@repo/domain/view-context";
import type {
  TimelineErrorRow,
  TimelineFileChange,
  TimelineRow,
  TimelineRowStatus,
  TimelineTurnRow,
  TimelineWorkRow,
} from "@repo/api/local/thread-timeline";
import type { TurnChanges } from "@repo/api/local/threads/threads-schema";
import { LoadingState } from "@repo/ui/ai/loading-state";
import { StreamingText } from "@repo/ui/ai/streaming-text";
import { Thinking, ThinkingReasoning, ThinkingStep } from "@repo/ui/ai/thinking";
import { ToolChip, ToolChipDetail, ToolChipList } from "@repo/ui/ai/tool-chips";
import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/cn";
import { plural } from "@repo/ui/lib/plural";
import { Undo2Icon } from "lucide-react";
import { memo } from "react";
import type { ReactNode } from "react";

import { NoteBadge } from "./note-badge";
import { turnNotePaths } from "./undo-turn";

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
      <NoteBadge key={path} path={path} />
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

// keyed by the row a turn's footer follows: the turn's last row, so the footer sits under its reply
// rather than above it.
export const turnFooterSlots = (
  rows: readonly TimelineRow[],
): ReadonlyMap<string, TimelineTurnRow> => {
  const turns = new Map<string, TimelineTurnRow>();
  const lastRows = new Map<string, string>();
  for (const row of rows) {
    if (row.turnId === null) {
      continue;
    }
    if (row.kind === "turn") {
      turns.set(row.turnId, row);
    }
    lastRows.set(row.turnId, row.id);
  }
  const slots = new Map<string, TimelineTurnRow>();
  for (const [turnId, rowId] of lastRows) {
    const turn = turns.get(turnId);
    if (turn !== undefined) {
      slots.set(rowId, turn);
    }
  }
  return slots;
};

// withheld while the thread runs: the running turn may hold the very notes an undo would merge.
export type TurnUndoState = "offered" | "pending" | "withheld";

interface TurnChangesFooterProps {
  status: TimelineRowStatus;
  changes: TurnChanges | undefined;
  undo: TurnUndoState;
  onUndo: (turnId: string) => void;
}

const TurnChangesFooterContent = ({ status, changes, undo, onUndo }: TurnChangesFooterProps) => {
  if (status === "pending" || changes === undefined) {
    return null;
  }
  const paths = turnNotePaths(changes);
  if (paths.length === 0) {
    return null;
  }
  if (changes.state === "undone") {
    return (
      <div className="flex items-center gap-1.5 text-body text-muted-foreground">
        <Undo2Icon className="size-3.5" />
        Changes undone
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <span className="text-body text-muted-foreground">
          Edited {plural(paths.length, "note")}
        </span>
        {undo === "withheld" ? null : (
          <Button
            variant="ghost"
            size="compact"
            leadingIcon={Undo2Icon}
            loading={undo === "pending"}
            onClick={() => {
              onUndo(changes.turnId);
            }}
          >
            Undo changes
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {paths.map((path) => (
          <NoteBadge key={path} path={path} />
        ))}
      </div>
    </div>
  );
};

// apart from TimelineRowView, so a streamed delta re-renders no footer and a refetched set of
// changes re-renders no row.
export const TurnChangesFooter = memo(TurnChangesFooterContent);

// the user bubble's shape, unfilled: the reply waits in the thread's queue, not yet in its events.
export const QueuedReplyView = ({ text }: { text: string }) => (
  <div className="flex flex-col items-end gap-0.5">
    <div className="max-w-[85%] rounded-2xl border border-dashed border-line px-3 py-1.5 text-subtitle whitespace-pre-wrap text-muted-foreground">
      {text}
    </div>
    <div className="px-3 text-caption text-muted-foreground">Queued</div>
  </div>
);
