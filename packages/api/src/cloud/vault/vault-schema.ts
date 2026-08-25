import { z } from "zod";

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
} as const;

/** One page's ceiling — also the default, since a phone wants few round
 *  trips and a row is small. */
export const VAULT_TREE_MAX_ENTRIES = 500;

/** Files above this never cross this wire; the phone reads notes, and a note
 *  this large is not one. Binary embeds need their own asset route. */
export const VAULT_FILE_MAX_BYTES = 2 * 1024 * 1024;

const gitOidSchema = z.string().regex(/^[0-9a-f]{40}$/u, "must be a full lowercase git oid");
const commitShaSchema = gitOidSchema;

/**
 * A vault-relative file path as git holds it: no leading slash, no empty or
 * dot-dot segments, no NUL. Deliberately a shape check, not the vault
 * engine's containment ladder — the Worker resolves paths inside a git tree,
 * where traversal has nothing to escape into.
 */
const vaultPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !path.includes("\0") &&
      !path.startsWith("/") &&
      path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    "must be a vault-relative path with no empty, '.', or '..' segments",
  );

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
