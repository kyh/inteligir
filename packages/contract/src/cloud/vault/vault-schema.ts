// The hosted vault's shapes the Mac's local server still reads: the path grammar, the asset
// allowlist and its cap, the tree page its own routes answer, and an asset's query.

import { normalVaultPathSchema as vaultPathSchema } from "@repo/notes/knowledge/vault-path-schema";
import { z } from "zod";

export { normalVaultPathSchema as vaultPathSchema } from "@repo/notes/knowledge/vault-path-schema";
export {
  assetKind,
  assetMediaType,
  takesBytes,
  VAULT_ASSET_MEDIA_TYPES,
} from "./vault-asset-media-types";
export type { AssetKind } from "./vault-asset-media-types";

const VAULT_TREE_MAX_ENTRIES = 500;

// the one spelling of a stored file's cap, which the desktop's routes re-export and an item's
// original is held to (ITEM_FILE_MAX_BYTES, held equal by a contract test)
export const VAULT_ASSET_MAX_BYTES = 10 * 1024 * 1024;

const gitOidSchema = z.string().regex(/^[0-9a-f]{40}$/u, "must be a full lowercase git oid");
const commitShaSchema = gitOidSchema;

export const vaultTreeResponseSchema = z.object({
  commit: commitShaSchema,
  entries: z
    .array(
      z.object({
        oid: gitOidSchema,
        path: vaultPathSchema,
        size: z.number().int().min(0),
      }),
    )
    .max(VAULT_TREE_MAX_ENTRIES),
  next: z.string().nullable(),
});
export type VaultTreeResponse = z.infer<typeof vaultTreeResponseSchema>;

// ref is required: a read pinned to a commit names immutable bytes, which the route answers
// `immutable`
export const vaultAssetQuerySchema = z.strictObject({
  path: vaultPathSchema,
  ref: commitShaSchema,
});
export type VaultAssetQuery = z.infer<typeof vaultAssetQuerySchema>;
