// the row grammar is bb's (github.com/get-bb/bb, MIT); the fold is this repo's own

import {
  COMMAND_OUTPUT_LINE_CHARS,
  COMMAND_OUTPUT_LINES,
} from "@repo/contract/local/thread-timeline";
import type {
  ThreadTimeline,
  TimelineCommandWorkRow,
  TimelineConversationRow,
  TimelineErrorRow,
  TimelineFileChange,
  TimelineRow,
  TimelineRowStatus,
  TimelineTurnChild,
  TimelineTurnRow,
  TimelineWorkRow,
} from "@repo/contract/local/thread-timeline";
import type { StoredThreadEvent } from "@repo/db/events";
import type {
  ThreadEventFileChange,
  ThreadEventItem,
  ThreadEventItemStatus,
  ThreadEventTurnStatus,
} from "@repo/domain/provider-event";

const toRowStatus = (status: ThreadEventItemStatus | ThreadEventTurnStatus): TimelineRowStatus =>
  status === "failed" ? "error" : status;

interface ItemAccumulator {
  threadId: string;
  turnId: string;
  itemId: string;
  started: ThreadEventItem | null;
  completed: ThreadEventItem | null;
  textBuffer: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  createdAt: number;
}

interface TurnAccumulator {
  threadId: string;
  turnId: string;
  status: TimelineRowStatus;
  completedAt: number | null;
  sourceSeqStart: number;
  ownSeqEnd: number;
  createdAt: number;
}

// the sequence a row sorts by travels beside it: a projected item sorts by where its first event
// landed, which its own sourceSeqStart only coincidentally matches
interface SequencedRow<Row extends TimelineRow> {
  seq: number;
  row: Row;
}

// a cut between a surrogate pair's halves would leave the first half alone
const LONE_HIGH_SURROGATE_AT_END = /[\uD800-\uDBFF]$/u;

const clipOutputLine = (line: string): string => {
  const clipped = line.slice(0, COMMAND_OUTPUT_LINE_CHARS);
  return LONE_HIGH_SURROGATE_AT_END.test(clipped) ? clipped.slice(0, -1) : clipped;
};

// a trailing newline ends the last line rather than opening an empty one. the lines are counted by
// a scan rather than split out, since the fold reruns per frame over every output in the thread
const commandOutput = (
  output: string,
): Pick<TimelineCommandWorkRow, "outputHead" | "outputLineCount"> => {
  const text = output.endsWith("\n") ? output.slice(0, -1) : output;
  if (text.trim() === "") {
    return { outputHead: [], outputLineCount: 0 };
  }
  let outputLineCount = 1;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    outputLineCount += 1;
  }
  return {
    outputHead: text.split("\n", COMMAND_OUTPUT_LINES).map(clipOutputLine),
    outputLineCount,
  };
};

const toTimelineFileChanges = (changes: readonly ThreadEventFileChange[]): TimelineFileChange[] =>
  changes.map((change) => ({
    diff: change.diff ?? null,
    kind: change.kind,
    movePath: change.movePath ?? null,
    path: change.path,
  }));

// a conversation row is always top-level and a work row joins its turn, so the kind places it
const projectItem = (
  accumulator: ItemAccumulator,
): TimelineConversationRow | TimelineWorkRow | null => {
  const snapshot = accumulator.completed ?? accumulator.started;
  if (snapshot === null) {
    // deltas for an item that never sent item/started cannot be typed
    return null;
  }
  const base = {
    createdAt: accumulator.createdAt,
    id: `item:${accumulator.turnId}:${accumulator.itemId}`,
    sourceSeqEnd: accumulator.sourceSeqEnd,
    sourceSeqStart: accumulator.sourceSeqStart,
    threadId: accumulator.threadId,
    turnId: accumulator.turnId,
  };
  const settled = accumulator.completed !== null;
  // a settled item carries its whole text; a streaming one, what its deltas have added so far.
  const itemText = (snapshotText: string): string =>
    settled ? snapshotText : snapshotText + accumulator.textBuffer;

  switch (snapshot.type) {
    case "agentMessage": {
      const row: TimelineConversationRow = {
        ...base,
        contextPaths: [],
        kind: "conversation",
        role: "assistant",
        text: itemText(snapshot.text),
        viewContext: null,
      };
      return row;
    }
    case "reasoning": {
      const row: TimelineWorkRow = {
        ...base,
        kind: "work",
        status: settled ? "completed" : "pending",
        text: itemText(snapshot.text),
        workKind: "reasoning",
      };
      return row;
    }
    case "toolCall": {
      const row: TimelineWorkRow = {
        ...base,
        kind: "work",
        result: snapshot.result === undefined ? null : JSON.stringify(snapshot.result),
        status: toRowStatus(snapshot.status),
        toolArgs: snapshot.arguments ?? null,
        toolName: snapshot.tool,
        workKind: "tool",
      };
      return row;
    }
    case "commandExecution": {
      const row: TimelineWorkRow = {
        ...base,
        ...commandOutput(snapshot.aggregatedOutput ?? ""),
        approvalStatus: snapshot.approvalStatus,
        command: snapshot.command,
        cwd: snapshot.cwd,
        kind: "work",
        status: toRowStatus(snapshot.status),
        workKind: "command",
      };
      return row;
    }
    case "fileChange": {
      const row: TimelineWorkRow = {
        ...base,
        approvalStatus: snapshot.approvalStatus,
        changes: toTimelineFileChanges(snapshot.changes),
        kind: "work",
        status: toRowStatus(snapshot.status),
        workKind: "file-change",
      };
      return row;
    }
    default: {
      const exhaustive: never = snapshot;
      return exhaustive;
    }
  }
};

// must be deterministic, ids included: the server diffs two projections into a delta
export const buildThreadTimeline = (events: readonly StoredThreadEvent[]): ThreadTimeline => {
  const ordered = events.toSorted((left, right) => left.sequence - right.sequence);

  const topLevel: SequencedRow<TimelineRow>[] = [];
  const turnsByTurnId = new Map<string, TurnAccumulator>();
  const turnChildren = new Map<string, SequencedRow<TimelineTurnChild>[]>();
  const itemsByKey = new Map<string, ItemAccumulator>();
  let maxSequence = 0;

  // a row joins a turn only once that turn has started; anything else stays top-level
  const place = (row: TimelineTurnChild, seq: number, turnId: string | null): void => {
    if (turnId === null || !turnsByTurnId.has(turnId)) {
      topLevel.push({ row, seq });
      return;
    }
    const children = turnChildren.get(turnId) ?? [];
    children.push({ row, seq });
    turnChildren.set(turnId, children);
  };

  const itemAccumulator = (
    entry: StoredThreadEvent,
    turnId: string,
    itemId: string,
  ): ItemAccumulator => {
    const key = `${turnId} ${itemId}`;
    const existing = itemsByKey.get(key);
    if (existing) {
      existing.sourceSeqEnd = entry.sequence;
      return existing;
    }
    const created: ItemAccumulator = {
      completed: null,
      createdAt: entry.createdAt,
      itemId,
      sourceSeqEnd: entry.sequence,
      sourceSeqStart: entry.sequence,
      started: null,
      textBuffer: "",
      threadId: entry.event.threadId,
      turnId,
    };
    itemsByKey.set(key, created);
    return created;
  };

  const startTurn = (entry: StoredThreadEvent, turnId: string): void => {
    if (turnsByTurnId.has(turnId)) {
      return;
    }
    turnsByTurnId.set(turnId, {
      completedAt: null,
      createdAt: entry.createdAt,
      ownSeqEnd: entry.sequence,
      sourceSeqStart: entry.sequence,
      status: "pending",
      threadId: entry.event.threadId,
      turnId,
    });
  };

  const completeTurn = (
    entry: StoredThreadEvent,
    status: ThreadEventTurnStatus,
    turnId: string,
  ): void => {
    const turn = turnsByTurnId.get(turnId);
    if (!turn) {
      return;
    }
    turn.status = toRowStatus(status);
    turn.completedAt = entry.createdAt;
    turn.ownSeqEnd = entry.sequence;
  };

  const captureItemSnapshot = (
    entry: StoredThreadEvent,
    turnId: string,
    item: ThreadEventItem,
    type: "item/completed" | "item/started",
  ): void => {
    const accumulator = itemAccumulator(entry, turnId, item.id);
    if (type === "item/started") {
      accumulator.started = item;
    } else {
      accumulator.completed = item;
    }
  };

  const appendItemDelta = (
    entry: StoredThreadEvent,
    turnId: string,
    itemId: string,
    delta: string,
  ): void => {
    itemAccumulator(entry, turnId, itemId).textBuffer += delta;
  };

  const applyEvent = (entry: StoredThreadEvent): void => {
    const { event } = entry;

    switch (event.type) {
      case "client/turn/requested": {
        const row: TimelineConversationRow = {
          contextPaths: event.contextPaths ?? [],
          createdAt: entry.createdAt,
          id: `user:${entry.sequence}`,
          kind: "conversation",
          role: "user",
          sourceSeqEnd: entry.sequence,
          sourceSeqStart: entry.sequence,
          text: event.text,
          threadId: event.threadId,
          turnId: null,
          viewContext: event.viewContext ?? null,
        };
        topLevel.push({ row, seq: entry.sequence });
        break;
      }
      case "turn/started": {
        startTurn(entry, event.scope.turnId);
        break;
      }
      case "turn/completed": {
        completeTurn(entry, event.status, event.scope.turnId);
        break;
      }
      case "item/started":
      case "item/completed": {
        captureItemSnapshot(entry, event.scope.turnId, event.item, event.type);
        break;
      }
      case "item/agentMessage/delta":
      case "item/reasoning/textDelta": {
        appendItemDelta(entry, event.scope.turnId, event.itemId, event.delta);
        break;
      }
      case "provider/error": {
        const scopeTurnId = event.scope.kind === "turn" ? event.scope.turnId : null;
        const row: TimelineErrorRow = {
          createdAt: entry.createdAt,
          detail: event.detail ?? null,
          id: `error:${entry.sequence}`,
          kind: "error",
          message: event.message,
          sourceSeqEnd: entry.sequence,
          sourceSeqStart: entry.sequence,
          threadId: event.threadId,
          turnId: scopeTurnId,
        };
        place(row, entry.sequence, scopeTurnId);
        break;
      }
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  };

  for (const entry of ordered) {
    maxSequence = Math.max(maxSequence, entry.sequence);
    applyEvent(entry);
  }

  for (const accumulator of itemsByKey.values()) {
    const row = projectItem(accumulator);
    if (row === null) {
      continue;
    }
    if (row.kind === "conversation") {
      topLevel.push({ row, seq: accumulator.sourceSeqStart });
    } else {
      place(row, accumulator.sourceSeqStart, accumulator.turnId);
    }
  }

  for (const turn of turnsByTurnId.values()) {
    const children = (turnChildren.get(turn.turnId) ?? []).toSorted(
      (left, right) => left.seq - right.seq,
    );
    // own plus children's, not every turn-scoped event: a streaming assistant message is
    // turn-scoped but lands top-level, and counting it would move this row per token, resending the
    // subtree
    let sourceSeqEnd = turn.ownSeqEnd;
    for (const child of children) {
      sourceSeqEnd = Math.max(sourceSeqEnd, child.row.sourceSeqEnd);
    }
    const row: TimelineTurnRow = {
      children: children.map((child) => child.row),
      completedAt: turn.completedAt,
      createdAt: turn.createdAt,
      id: `turn:${turn.turnId}`,
      kind: "turn",
      sourceSeqEnd,
      sourceSeqStart: turn.sourceSeqStart,
      status: turn.status,
      threadId: turn.threadId,
      turnId: turn.turnId,
    };
    topLevel.push({ row, seq: turn.sourceSeqStart });
  }

  const orderedTopLevel = topLevel.toSorted((left, right) => left.seq - right.seq);
  return {
    maxSequence,
    rows: orderedTopLevel.map((entry) => entry.row),
  };
};
