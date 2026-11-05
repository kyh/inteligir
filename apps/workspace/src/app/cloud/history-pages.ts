// History as the cell pages it (`library.history.list`): newest first, a page at a time, each
// answer naming the cursor of the next, so an item edited for an hour or a conversation of many
// turns reaches every set the cell keeps. One item's sets, or one conversation's.

import type { changeSetSchema } from "@repo/contract/cloud/library/library-wire";
import type { z } from "zod";

import type { CloudWire } from "./v1";

export type ChangeSet = z.infer<typeof changeSetSchema>;

type HistoryFilter = { readonly itemId: string } | { readonly threadId: string };

export const historyPages = (orpc: CloudWire["orpc"], filter: HistoryFilter) =>
  orpc.library.history.list.infiniteOptions({
    getNextPageParam: (last) => last.cursor,
    initialPageParam: undefined,
    input: (cursor: string | undefined) => ({ ...filter, cursor }),
  });

// the sets of every page asked so far, each once: the pages are counted from the newest, so a set
// made after an older page was asked moves the next page's first set onto it again
export const changeSetsOf = (
  pages: readonly { readonly changeSets: readonly ChangeSet[] }[],
): ChangeSet[] => {
  const seen = new Set<string>();
  return pages.flatMap((page) =>
    page.changeSets.filter((set) => {
      if (seen.has(set.id)) {
        return false;
      }
      seen.add(set.id);
      return true;
    }),
  );
};
