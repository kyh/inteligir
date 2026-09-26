import { parseVaultPath } from "@repo/notes/knowledge/vault-path";
import { z } from "zod";

export { isIgnoredEntryName } from "@repo/notes/knowledge/vault-path";
export { assetMediaType, VAULT_ASSET_MEDIA_TYPES } from "./vault-asset-media-types";

export const VAULT_API_PATHS = {
  asset: "/v1/vault/asset",
  file: "/v1/vault/file",
  files: "/v1/vault/files",
  tree: "/v1/vault/tree",
} as const;

export const VAULT_TREE_MAX_ENTRIES = 500;

export const VAULT_FILE_MAX_BYTES = 2 * 1024 * 1024;

// one read into the repo cell per path, beside the credential check, the budget, the registry and
// the commit check: under the 50 subrequests a Workers Free invocation may make
export const VAULT_FILES_MAX_PATHS = 40;

// the content one batch answers; past it the rest is deferred to a follow-up, except the first
// file, which always crosses so no note is deferred forever
export const VAULT_FILES_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

// equals the desktop asset route's cap; enforced from the tree's entry size before the blob
// crosses the repo cell's rpc, whose own message bound would fail opaquely
export const VAULT_ASSET_MAX_BYTES = 10 * 1024 * 1024;

const gitOidSchema = z.string().regex(/^[0-9a-f]{40}$/u, "must be a full lowercase git oid");
const commitShaSchema = gitOidSchema;

// a git push can place git's machinery and staging files in the hosted tree; the read routes
// must hide what the local engine would never list

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

// the query schemas parse a URL's search params whole, where every value arrives as a string
export const vaultTreeQuerySchema = z
  .object({
    after: vaultPathSchema.optional(),
    limit: z.coerce.number().int().min(1).max(VAULT_TREE_MAX_ENTRIES).optional(),
    ref: commitShaSchema.optional(),
  })
  .strict();
export type VaultTreeQuery = z.infer<typeof vaultTreeQuerySchema>;

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

export const vaultFileQuerySchema = z
  .object({
    path: vaultPathSchema,
    ref: commitShaSchema.optional(),
  })
  .strict();
export type VaultFileQuery = z.infer<typeof vaultFileQuerySchema>;

export const vaultFileResponseSchema = z.object({
  commit: commitShaSchema,
  content: z.string(),
  oid: gitOidSchema,
  path: vaultPathSchema,
});
export type VaultFileResponse = z.infer<typeof vaultFileResponseSchema>;

// ref is required: a mirror diffs a tree page by oid and fetches what changed, so every batch must
// read the revision that page named. Unpinned, a push landing mid-mirror would hand it bytes the
// listing never saw, under a commit it never recorded.
export const vaultFilesRequestSchema = z
  .object({
    paths: z
      .array(vaultPathSchema)
      .min(1)
      .max(VAULT_FILES_MAX_PATHS)
      .refine((paths) => new Set(paths).size === paths.length, "paths must be unique"),
    ref: commitShaSchema,
  })
  .strict();
export type VaultFilesRequest = z.infer<typeof vaultFilesRequestSchema>;

// the single-file route's refusals, answered per path so one file never fails the batch
const vaultFileRefusalSchema = z.enum(["file-too-large", "not-text"]);
export type VaultFileRefusal = z.infer<typeof vaultFileRefusalSchema>;

export const vaultFilesResponseSchema = z.object({
  commit: commitShaSchema,
  deferred: z.array(vaultPathSchema),
  files: z.array(
    z.object({
      content: z.string(),
      oid: gitOidSchema,
      path: vaultPathSchema,
    }),
  ),
  missing: z.array(vaultPathSchema),
  refused: z.array(z.object({ code: vaultFileRefusalSchema, path: vaultPathSchema })),
});
export type VaultFilesResponse = z.infer<typeof vaultFilesResponseSchema>;

// ref is required: a URL pinned to a commit names immutable bytes, which makes the URL the
// cache key (a phone's image cache ignores headers) and lets the route answer `immutable`
export const vaultAssetQuerySchema = z
  .object({
    path: vaultPathSchema,
    ref: commitShaSchema,
  })
  .strict();
export type VaultAssetQuery = z.infer<typeof vaultAssetQuerySchema>;
