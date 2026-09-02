// renders completed items only and lets streaming deltas pass: the completed item carries their
// final text.

import type { StoredThread } from "./sync-store";
import type { ThreadEvent } from "@repo/domain/provider-event";

export type ThreadDisplayItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "agent"; id: string; text: string }
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "tool"; id: string; label: string; failed: boolean }
  | { kind: "notice"; id: string; text: string };

export interface ThreadProjection {
  threadId: string;
  title: string;
  items: readonly ThreadDisplayItem[];
  preview: string;
}

const TITLE_MAX = 60;

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
}

function toolLabel(event: Extract<ThreadEvent, { type: "item/completed" }>): string | null {
  const item = event.item;
  switch (item.type) {
    case "toolCall":
      return item.server === undefined ? item.tool : `${item.server}/${item.tool}`;
    case "commandExecution":
      return firstLine(item.command);
    case "fileChange": {
      const paths = item.changes.map((change) => change.path);
      const head = paths[0] ?? "files";
      return paths.length > 1 ? `${head} +${paths.length - 1}` : head;
    }
    default:
      return null;
  }
}

function itemFailed(event: Extract<ThreadEvent, { type: "item/completed" }>): boolean {
  const item = event.item;
  return (
    (item.type === "toolCall" || item.type === "commandExecution" || item.type === "fileChange") &&
    item.status === "failed"
  );
}

function itemFrom(event: ThreadEvent, index: number): ThreadDisplayItem | null {
  switch (event.type) {
    case "client/turn/requested":
      return { kind: "user", id: `${event.threadId}:req:${index}`, text: event.text };
    case "provider/error":
      return { kind: "notice", id: `${event.threadId}:err:${index}`, text: event.message };
    case "item/completed": {
      const item = event.item;
      if (item.type === "userMessage") return { kind: "user", id: item.id, text: item.text };
      if (item.type === "agentMessage") return { kind: "agent", id: item.id, text: item.text };
      if (item.type === "reasoning") {
        const text = [...item.summary, ...item.content].join("\n").trim();
        return text === "" ? null : { kind: "reasoning", id: item.id, text };
      }
      if (item.type === "plan") return { kind: "agent", id: item.id, text: item.text };
      const label = toolLabel(event);
      return label === null
        ? null
        : { kind: "tool", id: item.id, label, failed: itemFailed(event) };
    }
    default:
      return null;
  }
}

export function projectThread(thread: StoredThread): ThreadProjection {
  const items: ThreadDisplayItem[] = [];
  thread.events.forEach((event, index) => {
    const item = itemFrom(event, index);
    if (item !== null) items.push(item);
  });
  const firstUser = items.find((item) => item.kind === "user");
  const lastText = items.toReversed().find((item) => item.kind !== "tool");
  return {
    threadId: thread.threadId,
    title: firstUser === undefined ? "Untitled thread" : firstLine(firstUser.text),
    items,
    preview: lastText === undefined ? "" : firstLine(lastText.text),
  };
}
