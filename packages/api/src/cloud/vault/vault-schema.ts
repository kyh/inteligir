import { isIgnoredEntryName, parseVaultPath } from "@repo/notes/knowledge/vault-path";
import { z } from "zod";
import { assetMediaType, VAULT_ASSET_MEDIA_TYPES } from "./vault-asset-media-types";

// The asset allowlist is shared with the desktop's own asset route — one
// table, one lookup, because both serve the same vault and a drift means an
// image that renders on one device and 400s on the other. Growing the table
// is additive (a stale phone never asks for a type it does not know); an
// entry is never removed, because old notes keep embedding old images.
export { assetMediaType, VAULT_ASSET_MEDIA_TYPES };

// ---------------------------------------------------------------------------
// The hosted vault's READ rows: how a client with no git client (the phone)
// reads notes out of the account's vault repo. Device-authed GETs beside the
// git wire in vault-git.ts — the Worker serves them over the repo cell's own
// RPC, so the store can change without touching a deployed phone.
//
// NEVER-BREAK: these shapes are final at birth. `.strict()` on every response
// means a stale client's parse REFUSES an added field as malformed, so a
// field this contract might ever want has to be here now — which is why both
// responses carry the commit they were read at, the tree carries its own
// pagination, and the file carries its blob oid.
//
// The tree is a flat listing of FILE paths (the vault's layout is plain
// nested markdown, so the client rebuilds any hierarchy it wants), paginated
// by path cursor and stable under `ref`: page one answers the commit it read,
// later pages pass it back and see the same tree whatever lands meanwhile.
// ---------------------------------------------------------------------------

export const VAULT_API_PATHS = {
  tree: "/v1/vault/tree",
  file: "/v1/vault/file",
  asset: "/v1/vault/asset",
} as const;

/** One page's ceiling — also the default, since a phone wants few round
 *  trips and a row is small. */
export const VAULT_TREE_MAX_ENTRIES = 500;

/** Files above this never cross this wire; the phone reads notes, and a note
 *  this large is not one. Binary embeds ride the asset route instead. */
export const VAULT_FILE_MAX_BYTES = 2 * 1024 * 1024;

/** The asset route's own ceiling — the desktop asset route's read cap. The
 *  route enforces it from the TREE's entry size BEFORE the blob crosses the
 *  repo cell's RPC (whose own message bound a giant blob would otherwise hit
 *  as an opaque failure), with the read-back length as the belt. */
export const VAULT_ASSET_MAX_BYTES = 10 * 1024 * 1024;

const gitOidSchema = z.string().regex(/^[0-9a-f]{40}$/u, "must be a full lowercase git oid");
const commitShaSchema = gitOidSchema;

/**
 * Entries the vault's own grammar hides: git's machinery and the write
 * path's staging files. The spelling is the vault engine's own — a git push
 * can place them in the hosted tree, and the read routes must not surface
 * what the local engine would never list, so the two must agree on what is
 * hidden (case-insensitive `.git` included).
 */
export { isIgnoredEntryName };

/**
 * A vault-relative file path as git holds it, judged by THE vault-path
 * grammar (`parseVaultPath`) — one grammar, every surface, because a
 * boundary with its own copy admits what another rejects. Deliberately not
 * the vault engine's containment ladder — the Worker resolves paths inside a
 * git tree, where traversal has nothing to escape into. The parse must be
 * the IDENTITY: a path the grammar would normalize (empty segments, a
 * trailing slash) is refused rather than silently renamed, since these
 * values address git trees verbatim.
 */
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
    /** Page the SAME tree a first page answered; absent = the current HEAD. */
    ref: commitShaSchema.optional(),
    /** Resume after this path (the previous page's `next`). */
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
    /** The cursor for the next page, or null when this page ends the tree. */
    next: z.string().nullable(),
  })
  .strict();
export type VaultTreeResponse = z.infer<typeof vaultTreeResponseSchema>;

export const vaultFileQuerySchema = z
  .object({
    path: vaultPathSchema,
    /** Read at this commit; absent = the current HEAD. */
    ref: commitShaSchema.optional(),
  })
  .strict();
export type VaultFileQuery = z.infer<typeof vaultFileQuerySchema>;

export const vaultFileResponseSchema = z
  .object({
    commit: commitShaSchema,
    path: vaultPathSchema,
    /** The blob's own id — a `(commit, path)`-independent cache key. */
    oid: gitOidSchema,
    /** UTF-8 text. A file that does not decode, or exceeds the byte ceiling,
     *  is refused rather than mangled. */
    content: z.string(),
  })
  .strict();
export type VaultFileResponse = z.infer<typeof vaultFileResponseSchema>;

/**
 * `GET /v1/vault/asset?path=…&ref=…` — an image embed's raw bytes, answered
 * with a content-type from the allowlist above rather than a JSON envelope
 * (base64 through `.strict()` JSON would tax every image by a third and buy
 * nothing a header does not already carry).
 *
 * `ref` is REQUIRED, unlike the file route's, and that is the design: a URL
 * pinned to a commit names immutable bytes, which makes the URL itself the
 * cache key — exactly what a phone's image cache keys on, since it ignores
 * headers — and lets the route answer long-lived `immutable` caching where
 * the desktop's mutable-vault route must revalidate. A client always holds a
 * commit before it can see an embed: the tree answered one.
 */
export const vaultAssetQuerySchema = z
  .object({
    path: vaultPathSchema,
    ref: commitShaSchema,
  })
  .strict();
export type VaultAssetQuery = z.infer<typeof vaultAssetQuerySchema>;
