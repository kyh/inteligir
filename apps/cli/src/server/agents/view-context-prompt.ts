// composed server-side: the cli is a second sender, and the stored `client/turn/requested.text`
// must stay exactly what the user typed. each block is its own `text` element, never a prefix on
// the user's string. `input` is the only channel: acp's session/new carries no instructions field,
// and the shell env is built once per session. not a tool: the agent can already read the file.
// The blocks run instructions, preset, view context, attached items, then the text.

import type { PromptInput } from "@repo/agent-runtime/types";
import type { LibraryScope } from "@repo/domain/library-scope";
import type { DocViewContext, LibraryViewContext, ViewContext } from "@repo/domain/view-context";
import { isItemKind } from "@repo/notes/items/item-kind";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { shellQuote } from "../../shell-quote";
import type { TurnRequest } from "../threads/turn-driver";
import { composePresetBlock } from "./action-preset-prompt";
import type { PromptFacts } from "./action-preset-prompt";

const composeDocBlock = (context: DocViewContext): string =>
  `The user sent this while looking at ${context.resource} in the editor — "this", "here" and "the note" refer to that file. It hashed to sha-256 ${context.revision} when they sent it; if it no longer does, it changed afterwards.`;

const KIND_PLURALS = {
  audio: "audio",
  file: "files",
  image: "images",
  link: "links",
  note: "notes",
  pdf: "PDFs",
  video: "videos",
} satisfies Record<ItemKind, string>;

const kindWords = (kind: string): string => (isItemKind(kind) ? KIND_PLURALS[kind] : kind);

const listed = (words: readonly string[]): string =>
  words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;

const scopeWords = (scope: LibraryScope): string => {
  switch (scope.kind) {
    case "all": {
      return "everything";
    }
    case "unsorted": {
      return "Unsorted";
    }
    case "folder": {
      return `the folder ${scope.path}`;
    }
    case "tag": {
      return `items tagged #${scope.tag}`;
    }
    case "deleted": {
      return "their deleted items";
    }
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
};

// the deleted view lists what `vault deleted` lists, which no kind or search narrows: those are
// gone from the library, so "these" there are rows to bring back, never live items to file or tag
const deletedListing = (context: LibraryViewContext): string => {
  const unfiltered =
    context.kinds === undefined && context.q === undefined
      ? ""
      : " (every deleted item, without the view's filter)";
  return `\`inteligir vault deleted --json\` lists them${unfiltered}. They are deleted items, no longer in the library: \`inteligir vault restore <path> <sha>\` brings one back, and none of them is a live item to file or tag.`;
};

// the listing command for what the view shows, the search left out (the listing has none). A
// folder's name and a search come from the library's files and the person's typing, so each is
// one sh word whatever it holds: the agent runs this command as it is written
const listingCommand = (context: LibraryViewContext): string => {
  if (context.scope.kind === "deleted") {
    return deletedListing(context);
  }
  const flags: string[] = [];
  if (context.scope.kind === "folder") {
    flags.push(`--folder ${shellQuote(context.scope.path)}`);
  }
  if (context.scope.kind === "unsorted") {
    flags.push("--folder Unsorted");
  }
  if (context.scope.kind === "tag") {
    flags.push(`--tag ${shellQuote(context.scope.tag)}`);
  }
  if (context.kinds !== undefined) {
    flags.push(`--kind ${context.kinds.join(",")}`);
  }
  const search =
    context.q === undefined
      ? ""
      : ` (without the search; \`inteligir search ${shellQuote(context.q)} --json\` finds its matches)`;
  return `\`inteligir items ${[...flags, "--json"].join(" ")}\` lists them${search}.`;
};

const composeLibraryBlock = (context: LibraryViewContext, facts: PromptFacts): string => {
  const kinds = context.kinds === undefined ? "" : `, only ${listed(context.kinds.map(kindWords))}`;
  const filter = context.q === undefined ? "" : `, filtered by “${context.q}”`;
  const lines = [
    `The person sent this from their library, looking at ${scopeWords(context.scope)}${kinds}${filter}.`,
  ];
  if (context.selected === 0) {
    lines.push(
      "Nothing was selected, so 'these', 'this' and 'the selection' mean every item that view shows.",
    );
  } else {
    const first =
      context.paths.length < context.selected
        ? ` (the first ${String(context.paths.length)} of ${String(context.selected)})`
        : "";
    const count = context.selected === 1 ? "the item" : `the ${String(context.selected)} items`;
    lines.push(
      `'These', 'this' and 'the selection' mean ${count} they selected${first}:`,
      ...context.paths.map((path) => `- ${path}`),
    );
  }
  if (facts.cli) {
    lines.push(listingCommand(context));
  }
  return lines.join("\n");
};

export const composeViewContextBlock = (context: ViewContext, facts: PromptFacts): string =>
  context.surface === "doc" ? composeDocBlock(context) : composeLibraryBlock(context, facts);

export const composeContextPathsBlock = (paths: readonly string[]): string =>
  `The user attached these items to the message; read them before answering:\n${paths.map((path) => `- ${path}`).join("\n")}`;

export const turnPromptInput = (
  turn: TurnRequest,
  facts: PromptFacts,
  instructions?: string,
): PromptInput[] => {
  const blocks: PromptInput[] = [];
  if (instructions !== undefined) {
    blocks.push({ text: instructions, type: "text" });
  }
  if (turn.preset !== undefined) {
    blocks.push({ text: composePresetBlock(turn.preset, facts), type: "text" });
  }
  if (turn.viewContext !== undefined) {
    blocks.push({ text: composeViewContextBlock(turn.viewContext, facts), type: "text" });
  }
  if (turn.contextPaths !== undefined && turn.contextPaths.length > 0) {
    blocks.push({ text: composeContextPathsBlock(turn.contextPaths), type: "text" });
  }
  blocks.push({ text: turn.text, type: "text" });
  return blocks;
};
