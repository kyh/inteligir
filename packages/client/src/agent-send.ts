// What a message to the built-in agent asks the cell (`library.agent.send`): the person's words,
// the thread it goes on with, and the screen it leaves from, so the agent knows what "this" is (the
// open item, or the library's scope and what is selected in it; nothing from Deleted, which the
// agent never reads).

import type { agentViewContextSchema } from "@repo/contract/library/library-wire";
import type { LibraryScope } from "@repo/contract/library-scope";
import { LIBRARY_SELECTION_MAX } from "@repo/contract/library-scope";
import type { z } from "zod";

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

// what the composer sends: the person's words on the thread open and the screen it leaves from;
// null when there is nothing to send
export const sendInput = (composer: {
  readonly text: string;
  readonly threadId: string | null;
  readonly viewContext: AgentViewContext | undefined;
}): SendInput | null => {
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
export const composerPlaceholder = (threadId: string | null): string =>
  threadId === null ? "Ask the agent…" : "Reply…";
