// History as the cell pages it (`library.history.list`): newest first, a page at a time, each
// answer naming the cursor of the next, so an item edited for an hour or a conversation of many
// turns reaches every set the cell keeps. One item's sets, or one conversation's.

import type { CloudWire } from "./v1";

type HistoryFilter = { readonly itemId: string } | { readonly threadId: string };

export const historyPages = (orpc: CloudWire["orpc"], filter: HistoryFilter) =>
  orpc.library.history.list.infiniteOptions({
    getNextPageParam: (last) => last.cursor,
    initialPageParam: undefined,
    input: (cursor: string | undefined) => ({ ...filter, cursor }),
  });
