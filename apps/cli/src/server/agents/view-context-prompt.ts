// composed server-side: the cli is a second sender, and the stored `client/turn/requested.text`
// must stay exactly what the user typed. each block is its own `text` element, never a prefix on
// the user's string. `input` is the only channel: acp's session/new carries no instructions field,
// and the shell env is built once per session. not a tool: the agent can already read the file.

import type { PromptInput } from "@repo/agent-runtime/types";
import type { ViewContext } from "@repo/domain/view-context";

export const composeViewContextBlock = (context: ViewContext): string =>
  `The user sent this while looking at ${context.resource} in the editor — "this", "here" and "the note" refer to that file. It hashed to sha-256 ${context.revision} when they sent it; if it no longer does, it changed afterwards.`;

export const composeContextPathsBlock = (paths: readonly string[]): string =>
  `The user attached these notes to the message; read them before answering:\n${paths.map((path) => `- ${path}`).join("\n")}`;

type TurnPromptText = Extract<PromptInput, { type: "text" }>;

interface TurnPromptFacts {
  text: string;
  contextPaths?: readonly string[];
  viewContext?: ViewContext;
}

export const turnPromptInput = (turn: TurnPromptFacts, instructions?: string): TurnPromptText[] => {
  const blocks: TurnPromptText[] = [];
  if (instructions !== undefined) {
    blocks.push({ text: instructions, type: "text" });
  }
  if (turn.viewContext !== undefined) {
    blocks.push({ text: composeViewContextBlock(turn.viewContext), type: "text" });
  }
  if (turn.contextPaths !== undefined && turn.contextPaths.length > 0) {
    blocks.push({ text: composeContextPathsBlock(turn.contextPaths), type: "text" });
  }
  blocks.push({ text: turn.text, type: "text" });
  return blocks;
};
