// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed to v1's grammar: bb's projection additionally folds web activity,
// background tasks, approvals, compaction, goals and window eviction.

import type {
  ThreadEvent,
  ThreadEventItem,
  ThreadEventItemStatus,
  ThreadEventTokenUsage,
  ThreadEventTurnStatus,
} from "@repo/domain/provider-event";
import type {
  ThreadTimeline,
  TimelineConversationRow,
  TimelineErrorRow,
  TimelineRow,
  TimelineRowStatus,
  TimelineTurnRow,
  TimelineWorkRow,
} from "@repo/server-contract/thread-timeline";

/** A stored event with the server-assigned metadata rows are ordered and
 *  keyed by. Matches @repo/db/events' StoredThreadEvent structurally — this
 *  package stays db-free so the same projection runs in any client. */
export interface ThreadTimelineEvent {
  sequence: number;
  createdAt: number;
  event: ThreadEvent;
}

function itemStatusToRowStatus(status: ThreadEventItemStatus): TimelineRowStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "completed":
      return "completed";
    case "failed":
      return "error";
    case "interrupted":
      return "interrupted";
  }
}

function turnStatusToRowStatus(status: ThreadEventTurnStatus): TimelineRowStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "error";
    case "interrupted":
      return "interrupted";
  }
}

interface ItemAccumulator {
  threadId: string;
  turnId: string;
  itemId: string;
  started: ThreadEventItem | null;
  completed: ThreadEventItem | null;
  /** agentMessage / plan deltas since item/started. */
  textBuffer: string;
  /** reasoning textDeltas since item/started. */
  reasoningBuffer: string;
  /** commandExecution outputDeltas since item/started (reset-aware). */
  outputBuffer: string;
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
  sourceSeqEnd: number;
  createdAt: number;
}

/**
 * Fold an ordered event log into the timeline read model. Pure and total: the
 * same events always produce the same rows with the same ids, which is what
 * lets the server diff two projections into a delta the client can apply.
 *
 * Row placement: user messages, assistant messages and thread-scoped errors
 * are top-level conversation rows; everything else an agent does inside a
 * turn (commands, tools, file changes, reasoning, plans, in-turn errors)
 * groups as children of that turn's row. Ordering is by first contributing
 * sequence throughout.
 */
export function buildThreadTimeline(events: readonly ThreadTimelineEvent[]): ThreadTimeline {
  const ordered = events.toSorted((left, right) => left.sequence - right.sequence);

  const topLevel: { seq: number; row: TimelineRow }[] = [];
  const turnOrder: string[] = [];
  const turnsByTurnId = new Map<string, TurnAccumulator>();
  const turnChildren = new Map<string, { seq: number; row: TimelineRow }[]>();
  const itemOrder: string[] = [];
  const itemsByKey = new Map<string, ItemAccumulator>();
  let tokenUsage: ThreadEventTokenUsage | null = null;
  let maxSequence = 0;

  function itemAccumulator(
    entry: ThreadTimelineEvent,
    turnId: string,
    itemId: string,
  ): ItemAccumulator {
    const key = `${turnId} ${itemId}`;
    const existing = itemsByKey.get(key);
    if (existing) {
      existing.sourceSeqEnd = entry.sequence;
      return existing;
    }
    const created: ItemAccumulator = {
      threadId: entry.event.threadId,
      turnId,
      itemId,
      started: null,
      completed: null,
      textBuffer: "",
      reasoningBuffer: "",
      outputBuffer: "",
      sourceSeqStart: entry.sequence,
      sourceSeqEnd: entry.sequence,
      createdAt: entry.createdAt,
    };
    itemsByKey.set(key, created);
    itemOrder.push(key);
    return created;
  }

  for (const entry of ordered) {
    const { event } = entry;
    maxSequence = Math.max(maxSequence, entry.sequence);
    const scopeTurnId = event.scope.kind === "turn" ? event.scope.turnId : null;
    if (scopeTurnId !== null) {
      const turn = turnsByTurnId.get(scopeTurnId);
      if (turn) {
        turn.sourceSeqEnd = entry.sequence;
      }
    }

    switch (event.type) {
      case "client/turn/requested": {
        const row: TimelineConversationRow = {
          kind: "conversation",
          role: "user",
          id: `user:${entry.sequence}`,
          threadId: event.threadId,
          turnId: null,
          text: event.text,
          sourceSeqStart: entry.sequence,
          sourceSeqEnd: entry.sequence,
          createdAt: entry.createdAt,
        };
        topLevel.push({ seq: entry.sequence, row });
        break;
      }
      case "turn/started": {
        if (scopeTurnId !== null && !turnsByTurnId.has(scopeTurnId)) {
          turnsByTurnId.set(scopeTurnId, {
            threadId: event.threadId,
            turnId: scopeTurnId,
            status: "pending",
            completedAt: null,
            sourceSeqStart: entry.sequence,
            sourceSeqEnd: entry.sequence,
            createdAt: entry.createdAt,
          });
          turnOrder.push(scopeTurnId);
        }
        break;
      }
      case "turn/completed": {
        const turn = scopeTurnId === null ? undefined : turnsByTurnId.get(scopeTurnId);
        if (turn) {
          turn.status = turnStatusToRowStatus(event.status);
          turn.completedAt = entry.createdAt;
        }
        break;
      }
      case "item/started":
      case "item/completed": {
        if (scopeTurnId === null) {
          break;
        }
        const accumulator = itemAccumulator(entry, scopeTurnId, event.item.id);
        if (event.type === "item/started") {
          accumulator.started = event.item;
        } else {
          accumulator.completed = event.item;
        }
        break;
      }
      case "item/agentMessage/delta":
      case "item/plan/delta": {
        if (scopeTurnId === null) {
          break;
        }
        const accumulator = itemAccumulator(entry, scopeTurnId, event.itemId);
        accumulator.textBuffer += event.delta;
        break;
      }
      case "item/reasoning/textDelta": {
        if (scopeTurnId === null) {
          break;
        }
        const accumulator = itemAccumulator(entry, scopeTurnId, event.itemId);
        accumulator.reasoningBuffer += event.delta;
        break;
      }
      case "item/commandExecution/outputDelta": {
        if (scopeTurnId === null) {
          break;
        }
        const accumulator = itemAccumulator(entry, scopeTurnId, event.itemId);
        accumulator.outputBuffer = event.reset
          ? event.delta
          : accumulator.outputBuffer + event.delta;
        break;
      }
      case "provider/error": {
        const row: TimelineErrorRow = {
          kind: "error",
          id: `error:${entry.sequence}`,
          threadId: event.threadId,
          turnId: scopeTurnId,
          message: event.message,
          detail: event.detail ?? null,
          sourceSeqStart: entry.sequence,
          sourceSeqEnd: entry.sequence,
          createdAt: entry.createdAt,
        };
        if (scopeTurnId !== null && turnsByTurnId.has(scopeTurnId)) {
          const children = turnChildren.get(scopeTurnId) ?? [];
          children.push({ seq: entry.sequence, row });
          turnChildren.set(scopeTurnId, children);
        } else {
          topLevel.push({ seq: entry.sequence, row });
        }
        break;
      }
      case "thread/tokenUsage/updated": {
        tokenUsage = event.tokenUsage;
        break;
      }
    }
  }

  for (const key of itemOrder) {
    const accumulator = itemsByKey.get(key);
    if (!accumulator) {
      continue;
    }
    const placed = projectItem(accumulator);
    if (placed === null) {
      continue;
    }
    if (placed.placement === "top-level" || !turnsByTurnId.has(accumulator.turnId)) {
      topLevel.push({ seq: accumulator.sourceSeqStart, row: placed.row });
      continue;
    }
    const children = turnChildren.get(accumulator.turnId) ?? [];
    children.push({ seq: accumulator.sourceSeqStart, row: placed.row });
    turnChildren.set(accumulator.turnId, children);
  }

  for (const turnId of turnOrder) {
    const turn = turnsByTurnId.get(turnId);
    if (!turn) {
      continue;
    }
    const children = (turnChildren.get(turnId) ?? []).toSorted(
      (left, right) => left.seq - right.seq,
    );
    const row: TimelineTurnRow = {
      kind: "turn",
      id: `turn:${turnId}`,
      threadId: turn.threadId,
      turnId,
      status: turn.status,
      completedAt: turn.completedAt,
      children: children.map((child) => child.row),
      sourceSeqStart: turn.sourceSeqStart,
      sourceSeqEnd: turn.sourceSeqEnd,
      createdAt: turn.createdAt,
    };
    topLevel.push({ seq: turn.sourceSeqStart, row });
  }

  const orderedTopLevel = topLevel.toSorted((left, right) => left.seq - right.seq);
  return {
    rows: orderedTopLevel.map((entry) => entry.row),
    maxSequence,
    tokenUsage,
  };
}

type PlacedRow =
  | { placement: "top-level"; row: TimelineRow }
  | { placement: "turn"; row: TimelineRow };

function projectItem(accumulator: ItemAccumulator): PlacedRow | null {
  const snapshot = accumulator.completed ?? accumulator.started;
  if (snapshot === null) {
    // Deltas for an item that never sent item/started cannot be typed; bb
    // drops such orphans too rather than inventing a row kind for them.
    return null;
  }
  const base = {
    id: `item:${accumulator.turnId}:${accumulator.itemId}`,
    threadId: accumulator.threadId,
    turnId: accumulator.turnId,
    sourceSeqStart: accumulator.sourceSeqStart,
    sourceSeqEnd: accumulator.sourceSeqEnd,
    createdAt: accumulator.createdAt,
  };
  const settled = accumulator.completed !== null;
  const settledStatus: TimelineRowStatus = settled ? "completed" : "pending";

  switch (snapshot.type) {
    case "userMessage": {
      const row: TimelineConversationRow = {
        ...base,
        kind: "conversation",
        role: "user",
        text: snapshot.text,
      };
      return { placement: "top-level", row };
    }
    case "agentMessage": {
      const row: TimelineConversationRow = {
        ...base,
        kind: "conversation",
        role: "assistant",
        // While streaming, the visible text is the started snapshot plus its
        // buffered deltas; the completed item's text supersedes the buffer.
        text: settled ? snapshot.text : snapshot.text + accumulator.textBuffer,
      };
      return { placement: "top-level", row };
    }
    case "reasoning": {
      const completedText = snapshot.content.join("\n\n");
      const row: TimelineWorkRow = {
        ...base,
        kind: "work",
        workKind: "reasoning",
        status: settledStatus,
        text: settled && completedText.length > 0 ? completedText : accumulator.reasoningBuffer,
      };
      return { placement: "turn", row };
    }
    case "plan": {
      const row: TimelineWorkRow = {
        ...base,
        kind: "work",
        workKind: "plan",
        status: settledStatus,
        text: settled ? snapshot.text : snapshot.text + accumulator.textBuffer,
      };
      return { placement: "turn", row };
    }
    case "toolCall": {
      const row: TimelineWorkRow = {
        ...base,
        kind: "work",
        workKind: "tool",
        status: itemStatusToRowStatus(snapshot.status),
        toolName: snapshot.tool,
        toolArgs: snapshot.arguments ?? null,
        result: snapshot.result === undefined ? null : JSON.stringify(snapshot.result),
        error: snapshot.error ?? null,
      };
      return { placement: "turn", row };
    }
    case "commandExecution": {
      const row: TimelineWorkRow = {
        ...base,
        kind: "work",
        workKind: "command",
        status: itemStatusToRowStatus(snapshot.status),
        command: snapshot.command,
        cwd: snapshot.cwd,
        output: snapshot.aggregatedOutput ?? accumulator.outputBuffer,
        exitCode: snapshot.exitCode ?? null,
        approvalStatus: snapshot.approvalStatus,
      };
      return { placement: "turn", row };
    }
    case "fileChange": {
      const row: TimelineWorkRow = {
        ...base,
        kind: "work",
        workKind: "file-change",
        status: itemStatusToRowStatus(snapshot.status),
        changes: snapshot.changes.map((change) => ({
          path: change.path,
          kind: change.kind,
          movePath: change.movePath ?? null,
          diff: change.diff ?? null,
        })),
        approvalStatus: snapshot.approvalStatus,
      };
      return { placement: "turn", row };
    }
  }
}
