// The cloud's reading of a page the library holds unread. The write that leaves a link waiting for
// its page asks for the reading in its own transaction, as a `fill` row of the job table, so a
// reading is never asked for a write that did not land and never lost by one that did. The row is
// due at once, whoever wrote: the built-in agent reads the web itself, so a turn's own save waits
// for nothing.

import { job } from "@repo/db/library-schema";

import type { LiveItemRow } from "./library-landing";
import type { WriteScope } from "./library-store";

// what a fill reads, by its job's payload: the item waiting, the address it waits at, and an image
// an import named as its cover, which the page's own may yield to
interface FillAsk {
  readonly itemId: string;
  readonly url: string;
  readonly coverHint: string | null;
}

// A link a write left waiting for its reading: one saved to read later, or one back from Deleted.
// A deleted item asks nothing, since a reading would land on nothing, and its way back asks again;
// a second ask before the first ran takes its place, since one reading of the page as it is now
// answers both
export const askFill = async (scope: WriteScope, { fields, id }: LiveItemRow): Promise<void> => {
  if (fields.reading.state !== "pending" || fields.url === null || fields.deletedAt !== null) {
    return;
  }
  const payload: FillAsk = { coverHint: null, itemId: id, url: fields.url };
  await scope.tx
    .insert(job)
    .values({
      accountId: scope.accountId,
      createdAt: scope.now,
      id: `fill:${id}`,
      kind: "fill",
      payload,
      runAt: scope.now,
    })
    .onConflictDoUpdate({
      set: { attempts: 0, payload, runAt: scope.now },
      target: [job.accountId, job.id],
    });
};
