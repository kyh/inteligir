// composed server-side: the cli is a second sender, and the stored `client/turn/requested.text`
// must stay exactly what the user typed. each block is its own `text` element, never a prefix on
// the user's string. `input` is the only channel: acp's session/new carries no instructions field,
// and the shell env is built once per session. not a tool: the agent can already read the file.

import type { PromptInput } from "@repo/agent-runtime/types";
import type { DocViewContext, LibraryViewContext, ViewContext } from "@repo/domain/view-context";
import type { TurnRequest } from "../threads/turn-driver";
import { composePresetBlock } from "./action-preset-prompt";
import type { PromptFacts } from "./action-preset-prompt";

// PIVOT-STUB(S3): the session's own facts, built from cliBinDir and the library's AGENTS.md and
// threaded through turnPromptInput (§12.4 point 5)
const UNKNOWN_FACTS: PromptFacts = { cli: false, filingRules: false };

const composeDocBlock = (context: DocViewContext): string =>
  `The user sent this while looking at ${context.resource} in the editor — "this", "here" and "the note" refer to that file. It hashed to sha-256 ${context.revision} when they sent it; if it no longer does, it changed afterwards.`;

// PIVOT-STUB(S3): the library's scope, filters and selection, in the agent's words (§6.7)
const composeLibraryBlock = (_context: LibraryViewContext): string => "";

export const composeViewContextBlock = (context: ViewContext): string =>
  context.surface === "doc" ? composeDocBlock(context) : composeLibraryBlock(context);

export const composeContextPathsBlock = (paths: readonly string[]): string =>
  `The user attached these notes to the message; read them before answering:\n${paths.map((path) => `- ${path}`).join("\n")}`;

export const turnPromptInput = (turn: TurnRequest, instructions?: string): PromptInput[] => {
  const blocks: PromptInput[] = [];
  if (instructions !== undefined) {
    blocks.push({ text: instructions, type: "text" });
  }
  const presetBlock =
    turn.preset === undefined ? "" : composePresetBlock(turn.preset, UNKNOWN_FACTS);
  if (presetBlock !== "") {
    blocks.push({ text: presetBlock, type: "text" });
  }
  const viewBlock = turn.viewContext === undefined ? "" : composeViewContextBlock(turn.viewContext);
  if (viewBlock !== "") {
    blocks.push({ text: viewBlock, type: "text" });
  }
  if (turn.contextPaths !== undefined && turn.contextPaths.length > 0) {
    blocks.push({ text: composeContextPathsBlock(turn.contextPaths), type: "text" });
  }
  blocks.push({ text: turn.text, type: "text" });
  return blocks;
};
