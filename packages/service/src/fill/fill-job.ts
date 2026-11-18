// One page the cloud reads: the payload of the `fill` job a write asks when a link lands unread (a
// saved link, an import's, one back from Deleted; `../library/library-fills`), which its run reads
// (`./fill-run`). It carries the item and the address alone, never the page, and a run that meets
// it twice lands it once, since a reading lands only on an item still waiting for it at that
// address.

import { isWebUrl } from "@repo/contract/items/item-url";
import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import { z } from "zod";

const webUrl = z
  .string()
  .max(ITEM_FIELD_CAPS.url)
  .refine(isWebUrl, { error: "is not a web address" });

export const fillJobSchema = z.strictObject({
  itemId: z.string().min(1).max(128),
  // the address the item held when its reading was asked for
  url: webUrl,
  // a picture the save knew of (a Raindrop cover), tried after the page's own
  coverHint: webUrl.nullable(),
});
export type FillJob = z.infer<typeof fillJobSchema>;
