// THE ONE COMPOSER of a view context into prompt text, and the one place a
// turn's `input` is assembled.
//
// Server-side, not client-side, for two reasons: the CLI is a second sender,
// and the stored `client/turn/requested.text` must stay exactly what the user
// typed — the timeline renders it verbatim, and stapling a preamble onto the
// user's own bubble is noise.
//
// It ships as a SEPARATE leading `text` element of `input` rather than a prefix
// on the user's string, so the boundary is structural and the user's text is
// never mangled. `input` is also the only per-turn channel codex honours, and
// the three alternatives are dead ends worth naming so nobody re-derives them:
// `RunTurnArgs.instructions` is forwarded but read only under
// `thread/start`/`thread/resume`, `buildThreadShellEnvironment` runs once per
// session (so an env var would refresh only after the idle reap), and session
// instructions are per session.
//
// No TOOL, either. The agent already has the file — it works in the vault
// checkout and has `inteligir vault read` — so a `get_view_context` tool would
// cost a round trip and a manual section to deliver what it can already fetch,
// and the one thing it could add (a LIVE selection) is the one thing that
// cannot be made honest. Revisit only for a surface whose content is not a file
// the agent can read.

import type { PromptInput } from "@repo/agent-runtime/types";
import { VIEW_CONTEXT_EXCERPT_MAX_BYTES, type ViewContext } from "@repo/domain/view-context";
import { headCapUtf8 } from "./agent-instructions";

function quoted(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * The block, as the model reads it. It states the referent (which is the whole
 * point — "this" and "here" have to resolve to something), the revision the
 * claim was true of (checkable: the agent has a shell and the file), and which
 * half of the selection is authoritative.
 */
export function composeViewContextBlock(context: ViewContext): string {
  const parts = [
    `The user sent this while looking at ${context.resource} in the editor — "this", "here" and "the note" refer to that file. It hashed to sha-256 ${context.revision} when they sent it; if it no longer does, it changed afterwards.`,
  ];
  const selection = context.selection;
  if (selection !== undefined) {
    const excerpt = headCapUtf8(selection.text, VIEW_CONTEXT_EXCERPT_MAX_BYTES);
    const cut =
      excerpt.length === selection.text.length
        ? ""
        : `, cut here to its first ${VIEW_CONTEXT_EXCERPT_MAX_BYTES} bytes`;
    parts.push(
      `They had this selected (characters ${selection.from}–${selection.to} of that revision${cut} — the quoted text is authoritative, the offsets are advisory):`,
      quoted(excerpt),
    );
  }
  return parts.join("\n\n");
}

/** Narrower than `PromptInput` on purpose: a turn this host dispatches is made
 *  of text and nothing else, so a reader of the result needs no narrow. */
type TurnPromptText = Extract<PromptInput, { type: "text" }>;

/**
 * A turn's prompt, in order: the view-context block (what the user was
 * looking at) when there is one, then the user's own text always, as its own
 * element — `context` undefined yields exactly `[{text}]`.
 */
export function turnPromptInput(text: string, context: ViewContext | undefined): TurnPromptText[] {
  const blocks: TurnPromptText[] = [];
  if (context !== undefined) {
    blocks.push({ type: "text", text: composeViewContextBlock(context) });
  }
  blocks.push({ type: "text", text });
  return blocks;
}
