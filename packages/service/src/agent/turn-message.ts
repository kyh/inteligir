// What a turn says to the built-in agent. A message is text blocks, the person's own words always
// the last of them: before them, the screen they wrote from, as a fenced `view-context` block of
// its JSON. The library's filing rules are no part of it: they are the definition's, sent after
// the prompt on every call (`./thread-request`), since they hold for the whole turn and the view
// context for one message (packages/agent-skills/built-in-agent.md says how the agent reads each).

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
