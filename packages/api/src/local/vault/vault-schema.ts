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
      // absent when the stat failed; the row still lists.
      modifiedMs: z.number().optional(),
      path: z.string().min(1),
    })
    .strict(),
]);
export type VaultEntry = z.infer<typeof vaultEntrySchema>;

export const vaultTreeResponseSchema = z
  .object({
    // depth-first, parents before children, folders before files.
    entries: z.array(vaultEntrySchema),
    // split from `root` by the server: a client splitting on "/" shows a whole windows path.
    name: z.string().min(1),
    root: z.string().min(1),
  })
  .strict();
export type VaultTreeResponse = z.infer<typeof vaultTreeResponseSchema>;

// utf-16 code units on the write schema, bytes on the read side; a bound, not a byte-exact quota.
export const VAULT_MAX_CONTENT_LENGTH = 10 * 1024 * 1024;

export const contentHashHex = async (content: string): Promise<string> => await sha256Hex(content);

export const contentHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const contentHashBytesHex = async (
  bytes: ArrayBuffer | Uint8Array<ArrayBuffer>,
): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hexFromBytes(new Uint8Array(digest));
};

// re-exported from the cloud side: local importing cloud is the direction the dep guard allows,
// and one table keeps both routes accepting the same images.
export { assetMediaType } from "@repo/api/cloud/vault/vault-schema";

export const vaultReadRequestSchema = z.object({ path: vaultPathSchema }).strict();
export type VaultReadRequest = z.infer<typeof vaultReadRequestSchema>;

export const vaultReadResponseSchema = z
  .object({
    content: z.string(),
    path: z.string().min(1),
  })
  .strict();
export type VaultReadResponse = z.infer<typeof vaultReadResponseSchema>;

// lands in a `<sha>:<path>` argv slot, so git's revision grammar (`@{…}`, `^{}`, a leading `-`)
// must be unexpressible. 64 rather than 40: a sha-256 repo names its objects in 64.
export const vaultRevisionShaSchema = z.string().regex(/^[0-9a-f]{7,64}$/u);

export const vaultRevisionSchema = z
  .object({
    authorEmail: z.string(),
    // read off the author by the server, so no client matches an email: the app's own save of
    // the user's edits, an agent's turn, or anyone else (another device, a person's own git).
    authorKind: z.enum(["app", "agent", "external"]),
    authorName: z.string(),
    // git's `%aI`.
    authoredAt: z.string().min(1),
    // the path at this revision: `--follow` crosses renames, and this is the path that reads
    // the bytes back.
    path: z.string().min(1),
    renamedFrom: z.string().min(1).optional(),
    sha: vaultRevisionShaSchema,
    subject: z.string(),
  })
  .strict();
export type VaultRevision = z.infer<typeof vaultRevisionSchema>;

export const VAULT_HISTORY_DEFAULT_LIMIT = 50;
export const VAULT_HISTORY_MAX_LIMIT = 200;

export const vaultHistoryRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(VAULT_HISTORY_MAX_LIMIT).optional(),
    path: vaultPathSchema,
    skip: z.number().int().min(0).optional(),
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

// no paths commits the whole dirty tree, a running agent turn's writes included; a caller
// checkpointing one note names it, so the turn's writes stay for the turn's own commit.
export const vaultCommitRequestSchema = z
  .object({ paths: z.array(vaultPathSchema).min(1) })
  .strict()
  .optional();

export const vaultCommitResponseSchema = z.object({ files: z.number().int().min(0) }).strict();
export type VaultCommitResponse = z.infer<typeof vaultCommitResponseSchema>;

// required, so last-writer-wins is a choice a caller spells rather than what it gets by
// forgetting a field. `expected` carries the sha-256 hex of the utf-8 bytes the write was derived
// from, and a mismatch answers CAS_MISMATCH with the current content; `absent` is a create, and
// never a hash of bytes not yet on disk, which no file could match.
const vaultWriteGuardSchema = z.discriminatedUnion("kind", [
  z.object({ hash: contentHashSchema, kind: z.literal("expected") }).strict(),
  z.object({ kind: z.literal("absent") }).strict(),
  z.object({ kind: z.literal("overwrite") }).strict(),
]);
export type VaultWriteGuard = z.infer<typeof vaultWriteGuardSchema>;

export const vaultWriteRequestSchema = z
  .object({
    content: z.string().max(VAULT_MAX_CONTENT_LENGTH),
    guard: vaultWriteGuardSchema,
    path: vaultPathSchema,
  })
  .strict();
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

// "" is the vault root: a vault path is never empty, and the root is a place an attachment can land.
export const vaultDirSchema = z.union([z.literal(""), vaultPathSchema]);

// the bytes ride as a Blob, which the rpc link sends as a multipart part rather than as base64
// inside the json body. the cap is the handler's, so an oversized file answers PAYLOAD_TOO_LARGE.
export const vaultAssetWriteRequestSchema = z
  .object({
    baseName: z.string().min(1),
    dir: vaultDirSchema,
    file: z.instanceof(Blob).refine((file) => file.size > 0, "an attachment holds no bytes"),
  })
  .strict();
export type VaultAssetWriteRequest = z.infer<typeof vaultAssetWriteRequestSchema>;

export const vaultAssetWriteResponseSchema = z.object({ path: z.string().min(1) }).strict();
export type VaultAssetWriteResponse = z.infer<typeof vaultAssetWriteResponseSchema>;

// where a pasted image lands: the vault root, the note's own folder, or one named folder
export const attachmentLocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("root") }).strict(),
  z.object({ kind: z.literal("beside-note") }).strict(),
  z.object({ kind: z.literal("folder"), path: vaultPathSchema }).strict(),
]);
export type AttachmentLocation = z.infer<typeof attachmentLocationSchema>;

export const DEFAULT_ATTACHMENTS_FOLDER = "assets";
export const DEFAULT_ATTACHMENT_LOCATION: AttachmentLocation = {
  kind: "folder",
  path: DEFAULT_ATTACHMENTS_FOLDER,
};

export const vaultPrefsResponseSchema = z
  .object({ attachments: attachmentLocationSchema })
  .strict();
export type VaultPrefsResponse = z.infer<typeof vaultPrefsResponseSchema>;

export const vaultSetPrefsRequestSchema = z
  .object({ attachments: attachmentLocationSchema })
  .strict();
export type VaultSetPrefsRequest = z.infer<typeof vaultSetPrefsRequestSchema>;

export const vaultMkdirRequestSchema = z.object({ path: vaultPathSchema }).strict();
export type VaultMkdirRequest = z.infer<typeof vaultMkdirRequestSchema>;

export const vaultMkdirResponseSchema = z.object({ path: z.string().min(1) }).strict();
export type VaultMkdirResponse = z.infer<typeof vaultMkdirResponseSchema>;

// doc paths no longer on disk. `sha` names the revision whose tree still holds the bytes — the
// deleting commit's parent, or HEAD for a deletion the auto-commit has not flushed yet — so a
// restore is `revision` read plus an `absent` write. latest deletion per path, newest first.
export const vaultDeletedEntrySchema = z
  .object({
    // git's `%aI` of the deleting commit; the read time for an unflushed deletion.
    deletedAt: z.string().min(1),
    path: z.string().min(1),
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

// a path two devices changed at once, settled by a sync here or by the device a pull came from:
// which version stayed at `path`, and where the other went. `at` is when this device learned of
// it. every surface words it through `describeSyncConflict` (`@repo/notes/sync/conflict-copy`).
export const vaultSyncConflictSchema = z.discriminatedUnion("kind", [
  z
    .object({
      at: z.number().int(),
      copyDevice: z.string(),
      copyPath: z.string().min(1),
      keptDevice: z.string(),
      kind: z.literal("copied"),
      path: z.string().min(1),
    })
    .strict(),
  z
    .object({
      at: z.number().int(),
      deletedDevice: z.string(),
      keptDevice: z.string(),
      kind: z.literal("kept-edit"),
      path: z.string().min(1),
    })
    .strict(),
]);
export type VaultSyncConflict = z.infer<typeof vaultSyncConflictSchema>;

// since the server started, newest first: a notice reads each as it arrives, and the copies
// themselves are the lasting record.
export const VAULT_SYNC_CONFLICTS_MAX = 20;

const syncStatusFields = {
  conflicts: z.array(vaultSyncConflictSchema).max(VAULT_SYNC_CONFLICTS_MAX),
  // the name a report's devices are told against: "yours" and "here" when one of them is this one.
  device: z.string().min(1),
  lastError: z.string().nullable(),
  lastSyncAt: z.number().int().nullable(),
};

// another service that already syncs the vault's folder, judged from where the folder physically
// sits. a second sync engine over one tree fights the first, so the hosted vault stays off there.
// `cloud-storage` is a File Provider folder this build has no name for; `provider` is the one its
// folder carries.
export const externalSyncSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("icloud-drive") }).strict(),
  z.object({ kind: z.literal("icloud-desktop-documents") }).strict(),
  z.object({ kind: z.literal("dropbox") }).strict(),
  z.object({ kind: z.literal("google-drive") }).strict(),
  z.object({ kind: z.literal("onedrive") }).strict(),
  z.object({ kind: z.literal("cloud-storage"), provider: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("obsidian-sync") }).strict(),
]);
export type ExternalSync = z.infer<typeof externalSyncSchema>;

// the service's own name, the one spelling the app and the CLI both say.
export const externalSyncName = (sync: ExternalSync): string => {
  switch (sync.kind) {
    case "icloud-drive":
    case "icloud-desktop-documents": {
      return "iCloud Drive";
    }
    case "dropbox": {
      return "Dropbox";
    }
    case "google-drive": {
      return "Google Drive";
    }
    case "onedrive": {
      return "OneDrive";
    }
    case "cloud-storage": {
      return sync.provider;
    }
    case "obsidian-sync": {
      return "Obsidian Sync";
    }
    default: {
      const exhaustive: never = sync;
      return exhaustive;
    }
  }
};

// "account" is the remote derived from the signed-in account (signing out removes it); "explicit"
// is the user's own: the vault's own origin, or the one INTELIGIR_VAULT_REMOTE pins.
const remoteFields = {
  remote: z.string().min(1),
  remoteSource: z.enum(["explicit", "account"]),
};

const remoteState = <State extends string>(state: State) =>
  z.object({ state: z.literal(state), ...remoteFields, ...syncStatusFields }).strict();

export const vaultStatusResponseSchema = z.discriminatedUnion("state", [
  // `externalSync` names the service that syncs the folder instead, which is why no hosted vault
  // was derived even when signed in.
  z
    .object({
      state: z.literal("no-remote"),
      externalSync: externalSyncSchema.nullable(),
      ...syncStatusFields,
    })
    .strict(),
  // a rebase or merge even its own abort could not clear; `lastError` names the manual recovery
  // and no pass runs while broken.
  remoteState("broken"),
  remoteState("clean"),
  remoteState("dirty"),
  remoteState("syncing"),
  // an agent turn holds the commits; its own state rather than a silent no-op, so "sync now"
  // cannot report a sync that never ran.
  remoteState("held"),
  // not `clean`: "unpushed" is measured against a remote-tracking ref a failed fetch left stale.
  remoteState("offline"),
  // not `offline`: offline heals on its own, this fails the same way until the user signs in again.
  remoteState("unauthorized"),
  // the remote answered and refused the push (a hook, a protected branch); `lastError` carries its
  // words. not `offline`: no retry changes the answer.
  remoteState("rejected"),
  // the remote answered that the push is larger than it takes (a 413): the hosted vault's cap, or
  // a proxy in front of the user's own remote. not `rejected`: what is refused is the history, so
  // the engine stops resending it until the history or the remote moves.
  remoteState("too-large"),
  // the signed-in account is not the one this vault last synced with; no pass runs, since a push
  // would upload these notes into an account that never held them.
  remoteState("account-mismatch"),
  // the vault's HEAD names no branch, so a pass has nothing to push; not `clean`, which it is not.
  remoteState("detached"),
]);
export type VaultStatusResponse = z.infer<typeof vaultStatusResponseSchema>;
