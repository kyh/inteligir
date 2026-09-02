// composed server-side: the cli is a second sender, and the stored `client/turn/requested.text`
// must stay exactly what the user typed. each block is its own `text` element, never a prefix on
// the user's string. `input` is the only channel: acp's session/new carries no instructions field,
// and the shell env is built once per session. not a tool: the agent can already read the file.

import type { PromptInput } from "@repo/agent-runtime/types";
import type { ViewContext } from "@repo/domain/view-context";

export function composeViewContextBlock(context: ViewContext): string {
  return `The user sent this while looking at ${context.resource} in the editor — "this", "here" and "the note" refer to that file. It hashed to sha-256 ${context.revision} when they sent it; if it no longer does, it changed afterwards.`;
}

type TurnPromptText = Extract<PromptInput, { type: "text" }>;

export function turnPromptInput(
  text: string,
  context: ViewContext | undefined,
  instructions?: string,
): TurnPromptText[] {
  const blocks: TurnPromptText[] = [];
  if (instructions !== undefined) {
    blocks.push({ type: "text", text: instructions });
  }
  if (context !== undefined) {
    blocks.push({ type: "text", text: composeViewContextBlock(context) });
  }
  blocks.push({ type: "text", text });
  return blocks;
}
