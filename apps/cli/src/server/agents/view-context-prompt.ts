// THE ONE COMPOSER of a turn's prompt: the session's standing instructions on
// the first turn, the view context when the sender named one, and the user's
// own text — in that order, and never anywhere else.
//
// Server-side, not client-side, for two reasons: the CLI is a second sender,
// and the stored `client/turn/requested.text` must stay exactly what the user
// typed — the timeline renders it verbatim, and stapling a preamble onto the
// user's own bubble is noise.
//
// Each block ships as a SEPARATE leading `text` element of `input` rather than
// a prefix on the user's string, so the boundary is structural and the user's
// text is never mangled. `input` is also the ONLY channel either preamble has:
// ACP's `session/new` carries no instructions field, and
// `buildThreadShellEnvironment` runs once per session (so an env var would
// refresh only after the idle reap).
//
// No TOOL, either. The agent already has the file — it works in the vault
// checkout and has `inteligir vault read` — so a `get_view_context` tool would
// cost a round trip and a manual section to deliver what it can already fetch,
// and the one thing it could add (a LIVE selection) is the one thing that
// cannot be made honest. Revisit only for a surface whose content is not a file
// the agent can read.

import type { PromptInput } from "@repo/agent-runtime/types";
import type { ViewContext } from "@repo/domain/view-context";

/**
 * The block, as the model reads it. It states the referent (which is the whole
 * point — "this" and "here" have to resolve to something) and the revision the
 * claim was true of (checkable: the agent has a shell and the file).
 */
export function composeViewContextBlock(context: ViewContext): string {
  return `The user sent this while looking at ${context.resource} in the editor — "this", "here" and "the note" refer to that file. It hashed to sha-256 ${context.revision} when they sent it; if it no longer does, it changed afterwards.`;
}

/** Narrower than `PromptInput` on purpose: a turn this host dispatches is made
 *  of text and nothing else, so a reader of the result needs no narrow. */
type TurnPromptText = Extract<PromptInput, { type: "text" }>;

/**
 * A turn's prompt, in order: the session instructions when this is the turn
 * that opened the session, the view-context block (what the user was looking
 * at) when there is one, then the user's own text always, as its own element —
 * both preambles undefined yields exactly `[{text}]`.
 */
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
