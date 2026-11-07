// History as the cell pages it (`library.history.list`): newest first, a page at a time, each
// answer naming the cursor of the next, so an item edited for an hour or a conversation of many
// turns reaches every set the cell keeps. One item's sets, or one conversation's.

import { changeSetsOf } from "@repo/agent-panel/thread-undo";

import type { CloudWire } from "./v1";

type HistoryFilter = { readonly itemId: string } | { readonly threadId: string };

// one undo after another, in the order they were asked
export const UNDO_SCOPE = { id: "history-undo" };

export const historyPages = (orpc: CloudWire["orpc"], filter: HistoryFilter) =>
  orpc.library.history.list.infiniteOptions({
    getNextPageParam: (last) => last.cursor,
    initialPageParam: undefined,
    input: (cursor: string | undefined) => ({ ...filter, cursor }),
  });

// every set as the cell holds them now, newest first, for what must not act on a list still
// catching up; run in a mutation, since a bare call fails at once offline
export const everyChangeSet = async (client: CloudWire["client"], filter: HistoryFilter) => {
  const pages = [];
  let cursor: string | undefined;
  do {
    const page = await client.library.history.list({ ...filter, cursor });
    pages.push(page);
    cursor = page.cursor ?? undefined;
  } while (cursor !== undefined);
  return changeSetsOf(pages);
};
