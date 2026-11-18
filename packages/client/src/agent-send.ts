import type { agentViewContextSchema } from "@repo/contract/library/library-wire";
import type { LibraryScope } from "@repo/contract/library-scope";
import { LIBRARY_SELECTION_MAX } from "@repo/contract/library-scope";
import type { z } from "zod";

export type AgentViewContext = z.infer<typeof agentViewContextSchema>;

type LibraryViewContext = Extract<AgentViewContext, { surface: "library" }>;

interface SendInput {
  text: string;
  threadId?: string;
  viewContext?: AgentViewContext;
}

export const viewContextOf = (screen: {
  readonly openItem: string | null;
  readonly scope: LibraryScope;
  readonly kind: NonNullable<LibraryViewContext["kinds"]>[number] | null;
  readonly selected: { readonly count: number; readonly ids: readonly string[] };
}) => {
  if (screen.openItem !== null) {
    return { itemId: screen.openItem, surface: "item" } satisfies AgentViewContext | undefined;
  }

  if (screen.scope.kind === "deleted") {
    return;
  }

  const library: LibraryViewContext = {
    itemIds: screen.selected.ids.slice(0, LIBRARY_SELECTION_MAX),
    scope: screen.scope,
    selected: screen.selected.count,
    surface: "library",
  };

  if (screen.kind !== null) {
    library.kinds = [screen.kind];
  }

  return library;
};

export const sendInput = (composer: {
  readonly text: string;
  readonly threadId: string | null;
  readonly viewContext: AgentViewContext | undefined;
}) => {
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

export const composerPlaceholder = (threadId: string | null) =>
  threadId === null ? "Ask the agent…" : "Reply…";
