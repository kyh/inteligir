import { hexFromBytes, sha256Hex } from "@repo/api/cloud/bytes";
import { parseVaultPath } from "@repo/notes/knowledge/vault-path";
import { z } from "zod";

// the same grammar as the server's filesystem gate; it normalizes as it parses, so handlers
// downstream treat the value as canonical.
export const vaultPathSchema = z.string().transform((value, ctx) => {
  const parsed = parseVaultPath(value);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.message });
    return z.NEVER;
  }
  return parsed.path;
});

// no `size`: it costs an lstat per file per walk and changes on every save, which defeats
// react-query's structural sharing and re-renders the whole workspace.
export const vaultEntrySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("dir"),
      path: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("file"),
      path: z.string().min(1),
      // absent when the stat failed; the row still lists.
      modifiedMs: z.number().optional(),
    })
    .strict(),
]);
export type VaultEntry = z.infer<typeof vaultEntrySchema>;

export const vaultTreeResponseSchema = z
  .object({
    root: z.string().min(1),
    // split from `root` by the server: a client splitting on "/" shows a whole windows path.
    name: z.string().min(1),
    // depth-first, parents before children, folders before files.
    entries: z.array(vaultEntrySchema),
  })
  .strict();
export type VaultTreeResponse = z.infer<typeof vaultTreeResponseSchema>;

// utf-16 code units on the write schema, bytes on the read side; a bound, not a byte-exact quota.
export const VAULT_MAX_CONTENT_LENGTH = 10 * 1024 * 1024;

export async function contentHashHex(content: string): Promise<string> {
  return sha256Hex(content);
}

export async function contentHashBytesHex(
  bytes: ArrayBuffer | Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hexFromBytes(new Uint8Array(digest));
}

// re-exported from the cloud side: local importing cloud is the direction the dep guard allows,
// and one table keeps both routes accepting the same images.
export { assetMediaType, VAULT_ASSET_MEDIA_TYPES } from "@repo/api/cloud/vault/vault-schema";

export const vaultReadRequestSchema = z.object({ path: vaultPathSchema }).strict();
export type VaultReadRequest = z.infer<typeof vaultReadRequestSchema>;

export const vaultReadResponseSchema = z
  .object({
    path: z.string().min(1),
    content: z.string(),
  })
  .strict();
export type VaultReadResponse = z.infer<typeof vaultReadResponseSchema>;

// lands in a `<sha>:<path>` argv slot, so git's revision grammar (`@{…}`, `^{}`, a leading `-`)
// must be unexpressible. 64 rather than 40: a sha-256 repo names its objects in 64.
export const vaultRevisionShaSchema = z.string().regex(/^[0-9a-f]{7,64}$/u);

export const vaultRevisionSchema = z
  .object({
    sha: vaultRevisionShaSchema,
    // git's `%aI`.
    authoredAt: z.string().min(1),
    authorName: z.string(),
    authorEmail: z.string(),
    subject: z.string(),
    // the path at this revision: `--follow` crosses renames, and this is the path that reads
    // the bytes back.
    path: z.string().min(1),
    renamedFrom: z.string().min(1).optional(),
  })
  .strict();
export type VaultRevision = z.infer<typeof vaultRevisionSchema>;

export const VAULT_HISTORY_DEFAULT_LIMIT = 50;
export const VAULT_HISTORY_MAX_LIMIT = 200;

export const vaultHistoryRequestSchema = z
  .object({
    path: vaultPathSchema,
    skip: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(VAULT_HISTORY_MAX_LIMIT).optional(),
  })
  .strict();
export type VaultHistoryRequest = z.infer<typeof vaultHistoryRequestSchema>;

// no `total`: a paginated log has no honest count of the rest.
export const vaultHistoryResponseSchema = z
  .object({ revisions: z.array(vaultRevisionSchema) })
  .strict();
export type VaultHistoryResponse = z.infer<typeof vaultHistoryResponseSchema>;

// `path` as of that revision, so a pre-rename revision is readable.
export const vaultRevisionRequestSchema = z
  .object({ path: vaultPathSchema, sha: vaultRevisionShaSchema })
  .strict();
export type VaultRevisionRequest = z.infer<typeof vaultRevisionRequestSchema>;

export const vaultRevisionResponseSchema = z.object({ content: z.string() }).strict();
export type VaultRevisionResponse = z.infer<typeof vaultRevisionResponseSchema>;

export const vaultCommitResponseSchema = z.object({ files: z.number().int().min(0) }).strict();
export type VaultCommitResponse = z.infer<typeof vaultCommitResponseSchema>;

export const vaultWriteRequestSchema = z
  .object({
    path: vaultPathSchema,
    content: z.string().max(VAULT_MAX_CONTENT_LENGTH),
    // sha-256 hex of the utf-8 bytes this write was derived from; a mismatch answers 409 with
    // the current content. omitted, the write is last-writer-wins.
    expectedHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
    ifAbsent: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => value.expectedHash === undefined || value.ifAbsent === undefined, {
    message: "expectedHash and ifAbsent are mutually exclusive",
  });
export type VaultWriteRequest = z.infer<typeof vaultWriteRequestSchema>;

export const vaultWriteResponseSchema = z.object({ path: z.string().min(1) }).strict();
export type VaultWriteResponse = z.infer<typeof vaultWriteResponseSchema>;

export const vaultRenameRequestSchema = z
  .object({
    from: vaultPathSchema,
    to: vaultPathSchema,
  })
  .strict();
export type VaultRenameRequest = z.infer<typeof vaultRenameRequestSchema>;

export const vaultRenameSkipReasonSchema = z.enum(["changed", "not_found", "unreadable"]);
export type VaultRenameSkipReason = z.infer<typeof vaultRenameSkipReasonSchema>;

export const vaultRenameResponseSchema = z
  .object({
    path: z.string().min(1),
    rewritten: z.array(z.string().min(1)),
    // a skip never fails the rename: the moved doc's recorded alias keeps those links resolving.
    skipped: z.array(
      z
        .object({
          path: z.string().min(1),
          reason: vaultRenameSkipReasonSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type VaultRenameResponse = z.infer<typeof vaultRenameResponseSchema>;

// gates the write and the read alike, and must not exceed the cloud route's own ceiling: an
// image accepted here and refused there renders on one device only.
export const VAULT_ASSET_MAX_BYTES = 10 * 1024 * 1024;

export const vaultAssetWriteRequestSchema = z
  .object({
    dir: vaultPathSchema,
    baseName: z.string().min(1),
    bytesBase64: z.string().min(1),
  })
  .strict();
export type VaultAssetWriteRequest = z.infer<typeof vaultAssetWriteRequestSchema>;

export const vaultAssetWriteResponseSchema = z.object({ path: z.string().min(1) }).strict();
export type VaultAssetWriteResponse = z.infer<typeof vaultAssetWriteResponseSchema>;

export const vaultMkdirRequestSchema = z.object({ path: vaultPathSchema }).strict();
export type VaultMkdirRequest = z.infer<typeof vaultMkdirRequestSchema>;

export const vaultMkdirResponseSchema = z.object({ path: z.string().min(1) }).strict();
export type VaultMkdirResponse = z.infer<typeof vaultMkdirResponseSchema>;

// doc paths no longer on disk. `sha` names the revision whose tree still holds the bytes — the
// deleting commit's parent, or HEAD for a deletion the auto-commit has not flushed yet — so a
// restore is `revision` read plus an `ifAbsent` write. latest deletion per path, newest first.
export const vaultDeletedEntrySchema = z
  .object({
    path: z.string().min(1),
    // git's `%aI` of the deleting commit; the read time for an unflushed deletion.
    deletedAt: z.string().min(1),
    sha: vaultRevisionShaSchema,
  })
  .strict();
export type VaultDeletedEntry = z.infer<typeof vaultDeletedEntrySchema>;

export const VAULT_DELETED_MAX_ENTRIES = 200;

export const vaultDeletedResponseSchema = z
  .object({ entries: z.array(vaultDeletedEntrySchema).max(VAULT_DELETED_MAX_ENTRIES) })
  .strict();
export type VaultDeletedResponse = z.infer<typeof vaultDeletedResponseSchema>;

export const vaultDeleteRequestSchema = z.object({ path: vaultPathSchema }).strict();
export type VaultDeleteRequest = z.infer<typeof vaultDeleteRequestSchema>;

export const vaultDeleteResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type VaultDeleteResponse = z.infer<typeof vaultDeleteResponseSchema>;

// computed after the abort; the repo is already back on a clean head when this is reported.
export const vaultConflictSchema = z
  .object({
    files: z.array(z.string().min(1)),
    ours: z.object({ commits: z.number().int().min(0) }).strict(),
    theirs: z.object({ commits: z.number().int().min(0) }).strict(),
  })
  .strict();
export type VaultConflict = z.infer<typeof vaultConflictSchema>;

const syncStatusFields = {
  lastSyncAt: z.number().int().nullable(),
  lastError: z.string().nullable(),
};

// "account" is the remote derived from the signed-in account (signing out removes it); "explicit"
// is the user's own.
const remoteFields = {
  remote: z.string().min(1),
  remoteSource: z.enum(["explicit", "account"]),
};

export const vaultStatusResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("no-remote"), ...syncStatusFields }).strict(),
  // rebase state even `rebase --abort` could not clear; `lastError` names the manual recovery
  // and no pass runs while broken.
  z
    .object({
      state: z.literal("broken"),
      ...remoteFields,
      ...syncStatusFields,
    })
    .strict(),
  z
    .object({
      state: z.literal("clean"),
      ...remoteFields,
      ...syncStatusFields,
    })
    .strict(),
  z
    .object({
      state: z.literal("dirty"),
      ...remoteFields,
      ...syncStatusFields,
    })
    .strict(),
  z
    .object({
      state: z.literal("syncing"),
      ...remoteFields,
      ...syncStatusFields,
    })
    .strict(),
  // an agent turn holds the commits; its own state rather than a silent no-op, so "sync now"
  // cannot report a sync that never ran.
  z
    .object({
      state: z.literal("held"),
      ...remoteFields,
      ...syncStatusFields,
    })
    .strict(),
  // not `clean`: "unpushed" is measured against a remote-tracking ref a failed fetch left stale.
  z
    .object({
      state: z.literal("offline"),
      ...remoteFields,
      ...syncStatusFields,
    })
    .strict(),
  // not `offline`: offline heals on its own, this fails the same way until the user signs in again.
  z
    .object({
      state: z.literal("unauthorized"),
      ...remoteFields,
      ...syncStatusFields,
    })
    .strict(),
  // the signed-in account is not the one this vault last synced with; no pass runs, since a push
  // would upload these notes into an account that never held them.
  z
    .object({
      state: z.literal("account-mismatch"),
      ...remoteFields,
      ...syncStatusFields,
    })
    .strict(),
  z
    .object({
      state: z.literal("conflict"),
      ...remoteFields,
      conflict: vaultConflictSchema,
      ...syncStatusFields,
    })
    .strict(),
]);
export type VaultStatusResponse = z.infer<typeof vaultStatusResponseSchema>;
