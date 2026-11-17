import { ITEM_KINDS } from "@repo/contract/items/item-kind";
import { libraryScopeSchema } from "@repo/contract/library-scope";
import { z } from "zod";

// anything else there is nothing
// oxlint-disable-next-line unicorn/no-useless-undefined, promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally and undefined IS the fallback
const orNothing = <Value extends z.ZodType>(value: Value) => z.catch(value.optional(), undefined);

// CLAUDE.md § Where the tab is rides the URL: the grid's scope and kind, no scope being All items,
// and the item open over them with the words a search found it by, which the item drops once its
// find bar is on them, so a reload or Back opens no bar
export const librarySearchSchema = z.object({
  find: orNothing(z.string()),
  item: orNothing(z.uuid()),
  kind: orNothing(z.enum(ITEM_KINDS)),
  scope: orNothing(libraryScopeSchema),
});

export type LibrarySearch = z.infer<typeof librarySearchSchema>;
