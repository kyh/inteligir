import type { Registry } from "durable-git";
import { treeListingPrefix } from "./tree-listing";

// every door names the repo here: one derivation, so a push and a read cannot name different repos
export const vaultRepoName = (userId: string): string => `vault-${userId}`;

// one spelling: reads consult it and deletion removes from it
export const vaultRegistry = (env: Env): DurableObjectStub<Registry> =>
  env.REGISTRY.getByName("registry");

// durable-git's own R2 layout, private to it and copied here: pushed packs, then clone-cache packs
// per ref version. vault-git.test.ts fills both before an account deletion, so a drift fails there
export const packCachePrefixes = (repo: string): readonly string[] => [
  `raw/${repo}/`,
  `pack/${repo}/`,
];

// A non-OK answer throws so beforeDelete aborts and the account survives to retry; a never-pushed
// repo wipes empty tables, so it is idempotent. Residual: a push whose pack is still uploading can
// recreate the repo after the wipe (dgit has no tombstone), and a tree read still walking can
// rewrite its listing slot; either orphan is unreachable, since every credential that could name it
// is revoked.
export const deleteVaultGitRepo = async (env: Env, userId: string): Promise<void> => {
  const repo = vaultRepoName(userId);
  // not gated on the registry: a purge must not trust an index, or a lost registry row leaves the bytes alive
  const response = await env.REPO.getByName(repo).fetch("https://vault-git/", {
    headers: { "x-repo": repo },
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`vault git repo delete failed: ${response.status}`);
  }
  // dgit's own R2 purge logs a failure and answers ok, which a deletion hook cannot trust; a throw aborts the deletion
  for (const prefix of [...packCachePrefixes(repo), treeListingPrefix(repo)]) {
    let cursor: string | undefined;
    do {
      const listing = await env.PACK_CACHE.list(
        cursor === undefined ? { prefix } : { cursor, prefix },
      );
      if (listing.objects.length > 0) {
        await env.PACK_CACHE.delete(listing.objects.map((object) => object.key));
      }
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor !== undefined);
  }
  await vaultRegistry(env).remove(repo);
};
