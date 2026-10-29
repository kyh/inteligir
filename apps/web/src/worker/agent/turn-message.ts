// What a turn says to the built-in agent. A message is text blocks, the person's own words always
// the last of them (`./turn-events` reads it back so): before them the screen they wrote from, as
// a fenced `view-context` block of its JSON, and, on the first message of a fresh session of a
// thread that already spoke, the conversation so far as a fenced `earlier-conversation` block, one
// JSON line a message, since a thread whose session stopped starts its next turn in a new one. The
// library's filing rules ride a system message beside a session's first message, as a system
// message applies to every later turn too, and the view context never does
// (packages/agent-skills/built-in-agent.md says how the agent reads each).

import type { SqlStatements } from "@repo/notes/library/library-sql";
import type { BetaManagedAgentsUserMessageEventParams } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { z } from "zod";

import { readLibraryRules } from "../library/cell-import-markdown";
import { messageTextOf } from "./turn-events";
import type { ThreadEventRow } from "./turn-events";
import type { TurnMessage } from "./turn-rows";

// how much of a thread's conversation a fresh session is seeded with, its latest messages first
const EARLIER_MAX_CHARS = 32_000;

interface TextBlock {
  readonly text: string;
  readonly type: "text";
}

const textBlock = (text: string): TextBlock => ({ text, type: "text" });

// a fence longer than any run of backticks the body holds, so no line of it closes the block
const fenced = (info: string, body: string): string => {
  const longest = Math.max(0, ...[...body.matchAll(/`+/gu)].map((run) => run[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${info}\n${body}\n${fence}`;
};

const spokenSchema = z.object({ json: z.string(), type: z.string() });

// the thread's messages, the person's and the agent's, newest first until the budget is spent,
// read back oldest first
const earlierConversation = (sql: SqlStatements, threadId: string): string | null => {
  const lines: string[] = [];
  let spent = 0;
  for (const raw of sql.all(
    `SELECT type, json FROM thread_events WHERE thread_id = ?
     AND type IN ('user.message', 'agent.message') ORDER BY idx DESC`,
    [threadId],
  )) {
    const row = spokenSchema.parse(raw);
    const event: ThreadEventRow["event"] = z.json().parse(JSON.parse(row.json));
    const text = messageTextOf(event);
    if (text === "") {
      continue;
    }
    const line = JSON.stringify({ role: row.type === "user.message" ? "person" : "agent", text });
    if (spent + line.length > EARLIER_MAX_CHARS) {
      break;
    }
    spent += line.length + 1;
    lines.push(line);
  }
  return lines.length === 0 ? null : lines.toReversed().join("\n");
};

// the user message a turn sends; `fresh` when it is its session's first
export const turnUserMessage = (
  sql: SqlStatements,
  turn: { readonly threadId: string; readonly message: TurnMessage },
  fresh: boolean,
): BetaManagedAgentsUserMessageEventParams => {
  const earlier = fresh ? earlierConversation(sql, turn.threadId) : null;
  const { viewContext } = turn.message;
  return {
    content: [
      ...(earlier === null ? [] : [textBlock(fenced("earlier-conversation", earlier))]),
      ...(viewContext === null
        ? []
        : [textBlock(fenced("view-context", JSON.stringify(viewContext)))]),
      textBlock(turn.message.text),
    ],
    type: "user.message",
  };
};

// the person's filing rules, for a session's first message, or null while the library keeps none
export const filingRules = (sql: SqlStatements) => {
  const rules = readLibraryRules(sql);
  return rules === null || rules.trim() === ""
    ? null
    : { content: [textBlock(rules)], type: "system.message" as const };
};
