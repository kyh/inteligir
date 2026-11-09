import { z } from "zod";

// CLAUDE.md § THE OPEN ITEM RIDES THE URL: `?item=<id>`, and anything else there opens nothing
export const librarySearchSchema = z.object({
  // oxlint-disable-next-line unicorn/no-useless-undefined, promise/valid-params, promise/prefer-await-to-then -- zod's catch, not a promise's: it takes the fallback positionally and undefined IS the fallback
  item: z.catch(z.uuid().optional(), undefined),
});
