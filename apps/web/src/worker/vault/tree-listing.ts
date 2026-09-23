import { z } from "zod";
import type { TreeFile } from "./tree-walk";

// one slot per repo holding the listing at the last head a read resolved. A key per commit would
// keep an object for every head any device ever listed, and only the newest is paged again.
export const treeListingPrefix = (repo: string): string => `listing/${repo}/`;

const listingKey = (repo: string): string => `${treeListingPrefix(repo)}head.json`;

// this worker is the slot's only writer, so the parse checks shape alone; the walk that filled it
// already refused every path the contract would.
const listingSchema = z.array(z.object({ path: z.string(), size: z.number() }).strict());

export interface TreeListingSlot {
  // the listing at `commit`, sorted by path; null when the slot holds another commit or none.
  read: (commit: string) => Promise<TreeFile[] | null>;
  write: (commit: string, files: readonly TreeFile[]) => Promise<void>;
}

// a cache failure is a miss: the walk answers every page on its own, only slower.
export const treeListingSlot = (bucket: R2Bucket, repo: string): TreeListingSlot => ({
  read: async (commit) => {
    try {
      const object = await bucket.get(listingKey(repo));
      if (object === null) {
        return null;
      }
      if (object.customMetadata?.commit !== commit) {
        await object.body.cancel();
        return null;
      }
      const parsed = listingSchema.safeParse(await object.json<unknown>());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  },
  write: async (commit, files) => {
    try {
      await bucket.put(listingKey(repo), JSON.stringify(files), {
        customMetadata: { commit },
      });
    } catch {
      // the next page walks again
    }
  },
});
