// What a message to the built-in agent asks the cell (`library.agent.send`): the person's words,
// the thread it goes on with, and the screen it leaves from, so the agent knows what "this" is (the
// open item, or the library's scope and what is selected in it; nothing from Deleted, which the
// agent never reads). Tidy my library is a send of its own: a new conversation on its request,
// from Unsorted, whatever the screen shows.

import type { agentViewContextSchema } from "@repo/contract/cloud/library/library-wire";
import type { LibraryScope } from "@repo/domain/library-scope";
import { LIBRARY_SELECTION_MAX } from "@repo/domain/library-scope";
import type { z } from "zod";

import { TIDY_PLACEHOLDER, TIDY_VIEW_CONTEXT, tidyMessage } from "./tidy-library";

export type AgentViewContext = z.infer<typeof agentViewContextSchema>;
type LibraryViewContext = Extract<AgentViewContext, { surface: "library" }>;

export interface SendInput {
  text: string;
  threadId?: string;
  viewContext?: AgentViewContext;
}

// the screen a message leaves from: the item open, else the library's scope, the kind it is
// narrowed to and the selection, the first of it by id; none from Deleted
export const viewContextOf = (screen: {
  readonly openItem: string | null;
  readonly scope: LibraryScope;
  readonly kind: NonNullable<LibraryViewContext["kinds"]>[number] | null;
  readonly selected: readonly string[];
}): AgentViewContext | undefined => {
  if (screen.openItem !== null) {
    return { itemId: screen.openItem, surface: "item" };
  }
  if (screen.scope.kind === "deleted") {
    return undefined;
  }
  const library: LibraryViewContext = {
    itemIds: screen.selected.slice(0, LIBRARY_SELECTION_MAX),
    scope: screen.scope,
    selected: screen.selected.length,
    surface: "library",
  };
  if (screen.kind !== null) {
    library.kinds = [screen.kind];
  }
  return library;
};

// what the composer sends: Tidy's request with what the person added, or their words on the thread
// open and the screen it leaves from; null when there is nothing to send
export const sendInput = (composer: {
  readonly text: string;
  readonly threadId: string | null;
  readonly tidying: boolean;
  readonly viewContext: AgentViewContext | undefined;
}): SendInput | null => {
  if (composer.tidying) {
    return { text: tidyMessage(composer.text), viewContext: TIDY_VIEW_CONTEXT };
  }
  const text = composer.text.trim();
  if (text === "") {
    return null;
  }
  const input: SendInput = { text };
  if (composer.threadId !== null) {
    input.threadId = composer.threadId;
  }
  if (composer.viewContext !== undefined) {
    input.viewContext = composer.viewContext;
  }
  return input;
};

// what the composer's field says before anything is typed
export const composerPlaceholder = (tidying: boolean, threadId: string | null): string => {
  if (tidying) {
    return TIDY_PLACEHOLDER;
  }
  return threadId === null ? "Ask the agent…" : "Reply…";
};
