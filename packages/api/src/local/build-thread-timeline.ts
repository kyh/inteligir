// the row grammar is bb's (github.com/get-bb/bb, MIT); the fold is this repo's own

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
} from "./thread-timeline";

// matches @repo/db/events' StoredThreadEvent structurally, not by import: this package is db-free
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
  textBuffer: string;
  reasoningBuffer: string;
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
  ownSeqEnd: number;
  createdAt: number;
}

// must be deterministic, ids included: the server diffs two projections into a delta
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

    switch (event.type) {
      case "client/turn/requested": {
        const row: TimelineConversationRow = {
          kind: "conversation",
          role: "user",
          id: `user:${entry.sequence}`,
          threadId: event.threadId,
          turnId: null,
          text: event.text,
          viewContext: event.viewContext ?? null,
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
            ownSeqEnd: entry.sequence,
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
          turn.ownSeqEnd = entry.sequence;
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
      case "item/reasoning/summaryTextDelta":
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
    // own plus children's, not every turn-scoped event: a streaming assistant message is
    // turn-scoped but lands top-level, and counting it moved this row per token, resending the subtree
    let sourceSeqEnd = turn.ownSeqEnd;
    for (const child of children) {
      sourceSeqEnd = Math.max(sourceSeqEnd, child.row.sourceSeqEnd);
    }
    const row: TimelineTurnRow = {
      kind: "turn",
      id: `turn:${turnId}`,
      threadId: turn.threadId,
      turnId,
      status: turn.status,
      completedAt: turn.completedAt,
      children: children.map((child) => child.row),
      sourceSeqStart: turn.sourceSeqStart,
      sourceSeqEnd,
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
    // deltas for an item that never sent item/started cannot be typed
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
        // a provider's echo of the user's message: the context belongs to the send that recorded it
        viewContext: null,
      };
      return { placement: "top-level", row };
    }
    case "agentMessage": {
      const row: TimelineConversationRow = {
        ...base,
        kind: "conversation",
        role: "assistant",
        text: settled ? snapshot.text : snapshot.text + accumulator.textBuffer,
        viewContext: null,
      };
      return { placement: "top-level", row };
    }
    case "reasoning": {
      // summary is the provider's visible thinking text (codex settles with content empty)
      const completedText = (
        snapshot.summary.length > 0 ? snapshot.summary : snapshot.content
      ).join("\n\n");
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
