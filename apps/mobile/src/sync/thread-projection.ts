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

const firstLine = (text: string): string => {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
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

const itemFrom = (event: ThreadEvent, index: number): ThreadDisplayItem | null => {
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
        const text = [...item.summary, ...item.content].join("\n").trim();
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
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/plan/delta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/started":
    case "thread/tokenUsage/updated":
    case "turn/completed":
    case "turn/started": {
      return null;
    }
    // no default
  }
};

export const projectThread = (thread: StoredThread): ThreadProjection => {
  const items: ThreadDisplayItem[] = [];
  for (const [index, event] of thread.events.entries()) {
    const item = itemFrom(event, index);
    if (item !== null) {
      items.push(item);
    }
  }
  const firstUser = items.find((item) => item.kind === "user");
  const lastText = items.toReversed().find((item) => item.kind !== "tool");
  return {
    items,
    preview: lastText === undefined ? "" : firstLine(lastText.text),
    threadId: thread.threadId,
    title: firstUser === undefined ? "Untitled thread" : firstLine(firstUser.text),
  };
};
