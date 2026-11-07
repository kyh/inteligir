// One page the cloud reads: the message the library cell sends to the `inteligir-fill` queue when
// a link lands unread (a saved link, a refresh, an import's, an agent's), and the queue hands to its
// consumer (`./fill-consumer`). It carries ids and the address alone, never the page, so it stays
// far under a message's 128 KB (https://developers.cloudflare.com/queues/platform/limits/), and a
// consumer that meets it twice lands it once, since the cell lands a reading only on an item still
// waiting for it at that address.

import { z } from "zod";

import { ITEM_FIELD_CAPS } from "@repo/notes/library/library-item";
import { isWebUrl } from "@repo/notes/items/item-url";

const webUrl = z
  .string()
  .max(ITEM_FIELD_CAPS.url)
  .refine(isWebUrl, { error: "is not a web address" });

export const fillJobSchema = z.strictObject({
  // the account whose cell holds the item; the cell is reached only through it
  accountId: z.string().min(1).max(128),
  itemId: z.string().min(1).max(128),
  // the address the item held when its reading was asked for
  url: webUrl,
  // a picture the save knew of (a Raindrop cover), tried after the page's own
  coverHint: webUrl.nullable(),
});
export type FillJob = z.infer<typeof fillJobSchema>;
