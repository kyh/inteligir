import { z } from "zod";

// anything else there is nothing
// oxlint-disable-next-line unicorn/no-useless-undefined, promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally and undefined IS the fallback
const orNothing = <Value extends z.ZodType>(value: Value) => z.catch(value.optional(), undefined);

// CLAUDE.md § The open item rides the URL: `?item=<id>`, and beside it the words a search found it
// by, which the item drops once its find bar is on them, so a reload or Back opens no bar
export const librarySearchSchema = z.object({
  find: orNothing(z.string()),
  item: orNothing(z.uuid()),
});
