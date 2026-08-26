// The vault's payload vocabulary: file CRUD over the vault directory plus the
// git sync surface. Paths are vault-relative POSIX strings, refused at the
// input boundary by `vaultPathSchema` below.

import { parseVaultPath } from "@repo/notes/knowledge/vault-path";
import { z } from "zod";

/**
 * EVERY caller-supplied vault path on the wire. The grammar is
 * `@repo/notes/knowledge/vault-path` — the same one the server's filesystem
 * gate runs — so a traversal is a 400 from the request validator rather than a
 * refusal each handler has to remember to catch, and the two can never disagree
 * about what a legal path is. It normalizes as it parses, which is why handlers
 * downstream can treat the value as canonical.
 */
export const vaultPathSchema = z.string().transform((value, ctx) => {
  const parsed = parseVaultPath(value);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.message });
    return z.NEVER;
  }
  return parsed.path;
});

/**
 * A tree row is a KIND and a PATH, and nothing that a content edit moves. The
 * listing carried a `size` no client ever read, and the cost was paid twice:
 * one `lstat` per file per walk, and a value that changes on every keystroke's
 * save — which defeats react-query's structural sharing and re-renders the
 * whole workspace for a tree that is structurally identical.
 */
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
      /** mtime for the sidebar's recency ordering; absent when the walk's
       *  stat failed (the row still lists). */
      modifiedMs: z.number().optional(),
    })
    .strict(),
]);
export type VaultEntry = z.infer<typeof vaultEntrySchema>;

export const vaultTreeResponseSchema = z
  .object({
    /** Absolute path of the vault root on this machine. */
    root: z.string().min(1),
    /** What to CALL the vault — `root`'s last segment, split by the server,
     *  which is the only side that knows which separator this machine uses.
     *  A browser splitting an absolute path on `/` renders a whole Windows
     *  path as the vault's name. */
    name: z.string().min(1),
    /** Depth-first, parents before children, folders sorted before files. */
    entries: z.array(vaultEntrySchema),
  })
  .strict();
export type VaultTreeResponse = z.infer<typeof vaultTreeResponseSchema>;

/**
 * Bound on a note's content, write and read alike. Measured in UTF-16 code
 * units on the write schema (what z.string().max counts) and in bytes on the
 * read side — the same order of magnitude either way, and the point is a
 * bound, not a byte-exact quota.
 */
export const VAULT_MAX_CONTENT_LENGTH = 10 * 1024 * 1024;

/**
 * THE content-hash convention behind the write CAS: sha-256 hex over the
 * UTF-8 bytes of the content string. Lives beside the schema that carries it
 * so client and server cannot hash differently; crypto.subtle keeps it
 * isomorphic (browser and node alike), which is why it is async.
 */
export async function contentHashHex(content: string): Promise<string> {
  return contentHashBytesHex(new TextEncoder().encode(content));
}

/**
 * The same convention, for a caller that already holds the bytes. A reader
 * comparing a file against a recorded hash does not need the string at all,
 * and decoding to UTF-16 only to re-encode to UTF-8 is two passes over every
 * file it is about to decide was unchanged.
 */
export async function contentHashBytesHex(
  bytes: ArrayBuffer | Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The image types the asset route will serve, extension → media type. It is
 * an ALLOWLIST rather than a lookup with a fallback, and that is the whole
 * security design of the route: the bytes come from a vault a hostile git
 * remote can write to, and they are served from the app's own origin, so a
 * guessed `text/html` would be stored XSS with the vault as the store. An
 * extension outside this table is refused rather than sent as
 * `application/octet-stream` — the editor renders only images, so a type it
 * cannot draw has no reason to leave the disk.
 *
 * SVG is here because notes carry diagrams, and it is the one entry that can
 * carry script. `<img>` never runs it; a direct NAVIGATION to the asset URL
 * would, which is why the route answers with a `sandbox` CSP.
 */
export const VAULT_ASSET_MEDIA_TYPES = new Map([
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

export const vaultReadRequestSchema = z.object({ path: vaultPathSchema }).strict();
export type VaultReadRequest = z.infer<typeof vaultReadRequestSchema>;

export const vaultReadResponseSchema = z
  .object({
    path: z.string().min(1),
    content: z.string(),
  })
  .strict();
export type VaultReadResponse = z.infer<typeof vaultReadResponseSchema>;

export const vaultWriteRequestSchema = z
  .object({
    path: vaultPathSchema,
    content: z.string().max(VAULT_MAX_CONTENT_LENGTH),
    /** Compare-and-swap guard: sha-256 hex of the UTF-8 bytes of the content
     * this write was derived from. The server compares against the file's
     * CURRENT bytes under the mutation lock; a mismatch answers 409 carrying
     * what the file holds now, so the client can merge and retry. Plain
     * writes (agent/CLI callers) omit it and stay last-writer-wins. */
    expectedHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .optional(),
    /** Create-exclusive ('wx' semantics): refuse 409 when the path already
     * exists. Mutually exclusive with expectedHash — a guard against a base
     * and a guard against existence contradict each other. */
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
    /** Candidate docs whose links were rewritten, by post-rename path. */
    rewritten: z.array(z.string().min(1)),
    /** Candidate docs whose rewrite was SKIPPED, with why — the client's
     *  "N links not updated" notice. A skip never fails the rename: the moved
     *  doc's recorded alias keeps the skipped links resolving. */
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

/** An attachment write: bytes land under `dir` with a name derived from
 * `baseName` (the host picks a collision-free one). Base64 in JSON because the
 * caller is the editor's paste handler and the payload is one image; the cap
 * below bounds it. */
export const VAULT_ASSET_WRITE_MAX_BYTES = 16 * 1024 * 1024;

export const vaultAssetWriteRequestSchema = z
  .object({
    dir: z.string().min(1),
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

/** One trashed note, as the trash listing reports it. `trashedFrom` /
 * `trashedAt` come from the frontmatter stamp the move writes; null covers a
 * note whose yaml refused the stamp or a file a user dropped into Trash/ by
 * hand — listed, restorable (the Trash-relative path is the fallback
 * destination), but never auto-purged, because an undated entry cannot age. */
export const vaultTrashEntrySchema = z
  .object({
    path: z.string().min(1),
    trashedFrom: z.string().min(1).nullable(),
    trashedAt: z.string().min(1).nullable(),
  })
  .strict();
export type VaultTrashEntry = z.infer<typeof vaultTrashEntrySchema>;

export const vaultTrashListResponseSchema = z
  .object({ entries: z.array(vaultTrashEntrySchema) })
  .strict();
export type VaultTrashListResponse = z.infer<typeof vaultTrashListResponseSchema>;

export const vaultTrashRequestSchema = z.object({ path: vaultPathSchema }).strict();
export type VaultTrashRequest = z.infer<typeof vaultTrashRequestSchema>;

/** The note's new path: under Trash/ after a move, back outside it after a
 * restore. */
export const vaultTrashMoveResponseSchema = z.object({ path: z.string().min(1) }).strict();
export type VaultTrashMoveResponse = z.infer<typeof vaultTrashMoveResponseSchema>;

export const vaultDeleteRequestSchema = z.object({ path: vaultPathSchema }).strict();
export type VaultDeleteRequest = z.infer<typeof vaultDeleteRequestSchema>;

export const vaultDeleteResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type VaultDeleteResponse = z.infer<typeof vaultDeleteResponseSchema>;

/** What a refused rebase left behind, computed after the abort — the repo
 *  itself is already back to a clean HEAD when this is reported. */
export const vaultConflictSchema = z
  .object({
    /** Paths changed on both sides since the merge base. */
    files: z.array(z.string().min(1)),
    ours: z.object({ commits: z.number().int().min(0) }).strict(),
    theirs: z.object({ commits: z.number().int().min(0) }).strict(),
  })
  .strict();
export type VaultConflict = z.infer<typeof vaultConflictSchema>;

const syncStatusFields = {
  /** Epoch ms of the last sync that pushed successfully. */
  lastSyncAt: z.number().int().nullable(),
  lastError: z.string().nullable(),
};

/** Every state with a remote carries WHERE it came from: "paired" is the
 *  account-derived hosted remote (unpair kills it), "explicit" is the user's
 *  own configuration — the unpair dialog's honesty depends on the split. */
const remoteFields = {
  remote: z.string().min(1),
  remoteSource: z.enum(["explicit", "paired"]),
};

export const vaultStatusResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("no-remote"), ...syncStatusFields }).strict(),
  /** A sync left rebase state behind that even `rebase --abort` could not
   *  clear; `lastError` names the manual recovery. The engine never syncs
   *  again while broken. */
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
  /** An agent turn holds the vault's commits, which a sync pass would have to
   *  break to run — so no pass starts while one is open. Its own state rather
   *  than a silent no-op: "Sync now" that answered `clean` under a hold would
   *  report a sync that never happened. Transient; the next pass runs when the
   *  turn settles. */
  z
    .object({
      state: z.literal("held"),
      ...remoteFields,
      ...syncStatusFields,
    })
    .strict(),
  /** The last pass could not reach the remote. NOT `clean`: "unpushed" is
   *  measured against the remote-tracking ref, which a failed fetch leaves
   *  exactly where it was — so a repo that is clean against a STALE ref would
   *  otherwise claim a sync that never happened, remote commits and all. */
  z
    .object({
      state: z.literal("offline"),
      ...remoteFields,
      ...syncStatusFields,
    })
    .strict(),
  /** The remote REFUSED the credential (a revoked device). Its own state
   *  rather than `offline` because the fixes are opposite: offline heals on
   *  its own, while every retry here fails the same way until the user
   *  re-pairs. */
  z
    .object({
      state: z.literal("unauthorized"),
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
