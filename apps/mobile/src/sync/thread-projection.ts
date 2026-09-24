// renders completed items only: each carries the final text of the deltas the store never holds.

import type { StoredThread, StoredThreadEvent } from "./sync-store";
import { settledReasoningText } from "@repo/domain/provider-event";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { deriveThreadTitle } from "@repo/domain/thread-title";

export type ThreadDisplayItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "agent"; id: string; text: string }
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "tool"; id: string; label: string; failed: boolean }
  | { kind: "notice"; id: string; text: string };

export interface ThreadProjection {
  threadId: string;
  title: string;
  archived: boolean;
  items: readonly ThreadDisplayItem[];
  preview: string;
}

const LINE_MAX = 60;

const firstLine = (text: string): string => {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1)}…` : line;
};

const toolLabel = (event: Extract<ThreadEvent, { type: "item/completed" }>): string | null => {
  const { item } = event;
  switch (item.type) {
    case "toolCall": {
      return item.server === undefined ? item.tool : `${item.server}/${item.tool}`;
    }
    case "commandExecution": {
      return firstLine(item.command);
    }
    case "fileChange": {
      const paths = item.changes.map((change) => change.path);
      const head = paths[0] ?? "files";
      return paths.length > 1 ? `${head} +${paths.length - 1}` : head;
    }
    case "agentMessage":
    case "plan":
    case "reasoning":
    case "userMessage": {
      return null;
    }
    // no default
  }
};

const itemFailed = (event: Extract<ThreadEvent, { type: "item/completed" }>): boolean => {
  const { item } = event;
  return (
    (item.type === "toolCall" || item.type === "commandExecution" || item.type === "fileChange") &&
    item.status === "failed"
  );
};

const itemFrom = (event: StoredThreadEvent, index: number): ThreadDisplayItem | null => {
  switch (event.type) {
    case "client/turn/requested": {
      return { id: `${event.threadId}:req:${index}`, kind: "user", text: event.text };
    }
    case "provider/error": {
      return { id: `${event.threadId}:err:${index}`, kind: "notice", text: event.message };
    }
    case "item/completed": {
      const { item } = event;
      if (item.type === "userMessage") {
        return { id: item.id, kind: "user", text: item.text };
      }
      if (item.type === "agentMessage") {
        return { id: item.id, kind: "agent", text: item.text };
      }
      if (item.type === "reasoning") {
        const text = settledReasoningText(item).trim();
        return text === "" ? null : { id: item.id, kind: "reasoning", text };
      }
      if (item.type === "plan") {
        return { id: item.id, kind: "agent", text: item.text };
      }
      const label = toolLabel(event);
      return label === null
        ? null
        : { failed: itemFailed(event), id: item.id, kind: "tool", label };
    }
    case "item/started":
    case "thread/archived":
    case "thread/meta":
    case "thread/tokenUsage/updated":
    case "turn/completed":
    case "turn/started": {
      return null;
    }
    // no default
  }
};

const foldThread = (thread: StoredThread): ThreadProjection => {
  const items: ThreadDisplayItem[] = [];
  let statedTitle: string | null = null;
  let archived = false;
  for (const [index, event] of thread.events.entries()) {
    if (event.type === "thread/meta" && event.title !== undefined) {
      statedTitle = event.title;
    }
    if (event.type === "thread/archived") {
      archived = true;
    }
    const item = itemFrom(event, index);
    if (item !== null) {
      items.push(item);
    }
  }
  const firstUser = items.find((item) => item.kind === "user");
  const lastText = items.toReversed().find((item) => item.kind !== "tool");
  // a log written before threads stated their titles still names them by the first line.
  const firstLineTitle = firstUser === undefined ? null : deriveThreadTitle(firstUser.text);
  return {
    archived,
    items,
    preview: lastText === undefined ? "" : firstLine(lastText.text),
    threadId: thread.threadId,
    title: statedTitle ?? firstLineTitle ?? "Untitled thread",
  };
};

// the desktop's order: live threads first, then archived ones, each run keeping its recency.
export const liveThreadsFirst = (threads: readonly ThreadProjection[]): ThreadProjection[] => [
  ...threads.filter((thread) => !thread.archived),
  ...threads.filter((thread) => thread.archived),
];

// a snapshot is never mutated, so its fold is final: a change to one thread re-folds that thread
// alone, not every thread the list holds.
const projections = new WeakMap<StoredThread, ThreadProjection>();

export const projectThread = (thread: StoredThread): ThreadProjection => {
  const cached = projections.get(thread);
  if (cached !== undefined) {
    return cached;
  }
  const projection = foldThread(thread);
  projections.set(thread, projection);
  return projection;
};
