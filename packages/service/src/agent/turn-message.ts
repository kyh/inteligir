// What a turn says to the built-in agent. A message is text blocks, the person's own words always
// the last of them: before them, the screen they wrote from, as a fenced `view-context` block of
// its JSON. The library's filing rules are no part of it: the thread sends them as a system
// message after the person's, when they are new to the conversation, changed or cleared, since a
// system message applies to every later turn too, and the view context never does
// (packages/agent-skills/built-in-agent.md says how the agent reads each).

import type { TurnMessage } from "./turn-rows";

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

// the user message a turn's thread sends
export const turnUserMessage = (message: TurnMessage): TextBlock[] => {
  const { viewContext } = message;
  return viewContext === null
    ? [textBlock(message.text)]
    : [textBlock(fenced("view-context", JSON.stringify(viewContext))), textBlock(message.text)];
};

// what a conversation that carried filing rules is told once the person has cleared them
export const RULES_CLEARED =
  "The person has cleared their filing rules. None apply from here on, including any you followed earlier in this conversation.";
