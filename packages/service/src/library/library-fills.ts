// The cloud's reading of a page the library holds unread. The write that leaves a link waiting for
// its page asks for the reading in its own transaction, as a `fill` row of the job table, so a
// reading is never asked for a write that did not land and never lost by one that did. The row is
// due at once, whoever wrote: the built-in agent reads the web itself, so a turn's own save waits
// for nothing.

import type { LibraryItemFields } from "@repo/contract/library/library-item";

import type { WriteScope } from "./library-store";

// what a fill reads, by its job's payload: the item waiting, the address it waits at, and an image
// an import named as its cover, which the page's own may yield to
interface FillAsk {
  readonly itemId: string;
  readonly url: string;
  readonly coverHint: string | null;
}

// an item a write landed that may wait for its page, and the picture an import named as its cover
interface Landed {
  readonly id: string;
  readonly fields: Pick<LibraryItemFields, "deletedAt" | "reading" | "url">;
  readonly cover?: string | null;
}

// Links a write left waiting for their reading: saved to read later, or back from Deleted. A
// deleted item asks nothing, since a reading would land on nothing, and its way back asks again;
// a second ask before the first ran takes its place, since one reading of the page as it is now
// answers both
export const askFills = async (scope: WriteScope, items: readonly Landed[]): Promise<void> => {
  await scope.askJobs(
    items.flatMap(({ cover = null, fields, id }) => {
      if (fields.reading.state !== "pending" || fields.url === null || fields.deletedAt !== null) {
        return [];
      }
      const payload: FillAsk = { coverHint: cover, itemId: id, url: fields.url };
      return [{ id: `fill:${id}`, kind: "fill" as const, payload }];
    }),
  );
};
