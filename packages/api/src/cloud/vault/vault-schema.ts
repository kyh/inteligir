import { isIgnoredEntryName, parseVaultPath } from "@repo/notes/knowledge/vault-path";
import { z } from "zod";
import { assetMediaType, VAULT_ASSET_MEDIA_TYPES } from "./vault-asset-media-types";

export { assetMediaType, VAULT_ASSET_MEDIA_TYPES };

// these shapes are final at birth: .strict() on every response means a stale phone's parse
// refuses an added field as malformed, so a field this wire might ever want has to be here now.

export const VAULT_API_PATHS = {
  tree: "/v1/vault/tree",
  file: "/v1/vault/file",
  asset: "/v1/vault/asset",
} as const;

export const VAULT_TREE_MAX_ENTRIES = 500;

export const VAULT_FILE_MAX_BYTES = 2 * 1024 * 1024;

// equals the desktop asset route's cap; enforced from the tree's entry size before the blob
// crosses the repo cell's rpc, whose own message bound would fail opaquely
export const VAULT_ASSET_MAX_BYTES = 10 * 1024 * 1024;

const gitOidSchema = z.string().regex(/^[0-9a-f]{40}$/u, "must be a full lowercase git oid");
const commitShaSchema = gitOidSchema;

// a git push can place git's machinery and staging files in the hosted tree; the read routes
// must hide what the local engine would never list
export { isIgnoredEntryName };

// the parse must be the identity: these values address git trees verbatim, so a path the
// grammar would normalize is refused rather than silently renamed
const vaultPathSchema = z.string().superRefine((value, ctx) => {
  const parsed = parseVaultPath(value);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.message });
    return;
  }
  if (parsed.path !== value) {
    ctx.addIssue({
      code: "custom",
      message: "path must be already normal — no empty segments or trailing slash",
    });
  }
});

export const vaultTreeQuerySchema = z
  .object({
    ref: commitShaSchema.optional(),
    after: vaultPathSchema.optional(),
    limit: z.number().int().min(1).max(VAULT_TREE_MAX_ENTRIES).optional(),
  })
  .strict();
export type VaultTreeQuery = z.infer<typeof vaultTreeQuerySchema>;

export const vaultTreeResponseSchema = z
  .object({
    commit: commitShaSchema,
    entries: z
      .array(
        z
          .object({
            path: vaultPathSchema,
            size: z.number().int().min(0),
          })
          .strict(),
      )
      .max(VAULT_TREE_MAX_ENTRIES),
    next: z.string().nullable(),
  })
  .strict();
export type VaultTreeResponse = z.infer<typeof vaultTreeResponseSchema>;

export const vaultFileQuerySchema = z
  .object({
    path: vaultPathSchema,
    ref: commitShaSchema.optional(),
  })
  .strict();
export type VaultFileQuery = z.infer<typeof vaultFileQuerySchema>;

export const vaultFileResponseSchema = z
  .object({
    commit: commitShaSchema,
    path: vaultPathSchema,
    oid: gitOidSchema,
    content: z.string(),
  })
  .strict();
export type VaultFileResponse = z.infer<typeof vaultFileResponseSchema>;

// ref is required: a URL pinned to a commit names immutable bytes, which makes the URL the
// cache key (a phone's image cache ignores headers) and lets the route answer `immutable`
export const vaultAssetQuerySchema = z
  .object({
    path: vaultPathSchema,
    ref: commitShaSchema,
  })
  .strict();
export type VaultAssetQuery = z.infer<typeof vaultAssetQuerySchema>;
