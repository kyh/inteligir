// what a row of the phone's outbox holds, parsed on every read: the user's intent, and once the
// vault has refused it as stale, the one change set that settles it. The intent is kept beside the
// settle because an edit made while the set is out is rebased onto what the set landed.

import { z } from "zod";
import { hexFromBytes } from "@repo/api/cloud/bytes";
import { vaultCommitRequestSchema } from "@repo/api/cloud/vault/vault-commit-schema";
import type { VaultChangeRequest } from "@repo/api/cloud/vault/vault-commit-schema";
import { gitOidSchema, vaultPathSchema } from "@repo/api/cloud/vault/vault-schema";
import type { SyncConflictReport } from "@repo/notes/sync/conflict-copy";
import { diff3 } from "@repo/notes/text/diff3";

// a note's new text, guarded by the blob it was computed from: one a rename rewrites the links of,
// or one a new comment's markers went into
const guardedTextSchema = z.object({
  baseContent: z.string(),
  baseOid: gitOidSchema,
  content: z.string(),
  path: vaultPathSchema,
});
export type GuardedText = z.infer<typeof guardedTextSchema>;

// `baseOid` / `baseContent` name the blob the write was computed from and its text: the vault
// takes the write only while the path still holds that blob, and a write refused as stale is
// merged against that text. A rename keeps the note's text where the phone holds it, since
// settling a rename onto a taken name merges the two notes; its `content` is the note's text at
// the new name when the rename changes it (its alias, its own links), null for the bytes as they
// are, and its `rewrites` the other notes whose links name it, all one change set. A delete takes
// the comment stores that go with the note in the same set, so a note the vault keeps keeps them.
// A comment edit is its store's new text and, when it anchors a new comment, the note's with the
// markers in it, one set, so no pull finds markers with no comment behind them.
export const vaultOpSchema = z.discriminatedUnion("op", [
  z.object({
    baseContent: z.string(),
    baseOid: gitOidSchema,
    content: z.string(),
    op: z.literal("write"),
    path: vaultPathSchema,
  }),
  z.object({ content: z.string(), op: z.literal("create"), path: vaultPathSchema }),
  z.object({
    baseContent: z.string().nullable(),
    baseOid: gitOidSchema,
    content: z.string().nullable().default(null),
    from: vaultPathSchema,
    op: z.literal("rename"),
    rewrites: z.array(guardedTextSchema).default([]),
    to: vaultPathSchema,
  }),
  z.object({
    // null: the edit leaves the note's bytes as they are (a reply, a resolve)
    anchored: guardedTextSchema.nullable(),
    op: z.literal("comment"),
    // a null base is a store not there yet
    store: z.object({
      base: z.object({ content: z.string(), oid: gitOidSchema }).nullable(),
      content: z.string(),
      path: vaultPathSchema,
    }),
  }),
  z.object({
    baseOid: gitOidSchema,
    op: z.literal("remove"),
    path: vaultPathSchema,
    stores: z.array(z.object({ baseOid: gitOidSchema, path: vaultPathSchema })).default([]),
  }),
  z.object({
    op: z.literal("putAsset"),
    path: vaultPathSchema,
    size: z.number().int().nonnegative(),
    // the bytes wait in a staged file named by their blob oid
    stagedFile: z.string().min(1),
  }),
]);
export type VaultOp = z.infer<typeof vaultOpSchema>;

export type TextOp = Extract<VaultOp, { op: "write" | "create" }>;

export type RenameOp = Extract<VaultOp, { op: "rename" }>;

export type CommentOp = Extract<VaultOp, { op: "comment" }>;

// what the vault held at a path when a conflict answered, and whose commit last wrote it; `text`
// is null for bytes that are not a note's
const vaultSideSchema = z.object({
  commit: gitOidSchema,
  device: z.string().nullable(),
  oid: gitOidSchema,
  path: vaultPathSchema,
  text: z.string().nullable(),
});
export type VaultSide = z.infer<typeof vaultSideSchema>;

const conflictReportSchema = z.discriminatedUnion("kind", [
  z.object({
    copyDevice: z.string(),
    copyPath: z.string(),
    keptDevice: z.string(),
    kind: z.literal("copied"),
    path: z.string(),
  }),
  z.object({
    deletedDevice: z.string(),
    keptDevice: z.string(),
    kind: z.literal("kept-edit"),
    path: z.string(),
  }),
]) satisfies z.ZodType<SyncConflictReport>;

// `against`: the vault's version of the op's path the set was reconciled against, null when it held
// nothing there; the mirror takes it when the set lands without writing that path. `mine`: the
// text the set was reconciled from, so an edit made since lands rebased onto the set's result.
export const settleSchema = z.object({
  against: vaultSideSchema.nullable(),
  changes: vaultCommitRequestSchema.shape.changes,
  mine: z.string().nullable(),
  reports: z.array(conflictReportSchema),
});
export type Settle = z.infer<typeof settleSchema>;

// a parked row is one the vault refused for a reason no resend passes; its bytes stay until the
// user retries, keeps them as a new note or discards them
export type RowState = { kind: "pending" } | { kind: "parked"; reason: string };

export interface OutboxRow {
  seq: number;
  op: VaultOp;
  state: RowState;
  settle: Settle | null;
  // unix ms: the commit is dated when the phone made the change, not when it reached the vault
  createdAt: number;
}

export const opPaths = (op: VaultOp): readonly string[] => {
  switch (op.op) {
    case "rename": {
      return [op.from, op.to, ...op.rewrites.map((rewrite) => rewrite.path)];
    }
    case "remove": {
      return [op.path, ...op.stores.map((store) => store.path)];
    }
    case "comment": {
      return op.anchored === null ? [op.store.path] : [op.anchored.path, op.store.path];
    }
    case "write":
    case "create":
    case "putAsset": {
      return [op.path];
    }
    // no default
  }
};

export const isTextOp = (op: VaultOp): op is TextOp => op.op === "write" || op.op === "create";

export const putText = (path: string, base: string | null, text: string): VaultChangeRequest => ({
  base,
  content: { encoding: "utf-8", text },
  op: "put",
  path,
});

export const rewritePuts = (op: RenameOp): VaultChangeRequest[] =>
  op.rewrites.map((rewrite) => putText(rewrite.path, rewrite.baseOid, rewrite.content));

// a set names each path once, so a rename that changes the note's text deletes the old path and
// puts the new one, which the vault guards exactly as a move: the source's blob, a free name
export const renameChanges = (op: RenameOp): VaultChangeRequest[] => {
  const move: VaultChangeRequest[] =
    op.content === null
      ? [{ base: op.baseOid, from: op.from, op: "move", to: op.to }]
      : [{ base: op.baseOid, op: "delete", path: op.from }, putText(op.to, null, op.content)];
  return [...move, ...rewritePuts(op)];
};

export const commentChanges = (op: CommentOp): VaultChangeRequest[] => [
  ...(op.anchored === null
    ? []
    : [putText(op.anchored.path, op.anchored.baseOid, op.anchored.content)]),
  putText(op.store.path, op.store.base?.oid ?? null, op.store.content),
];

// the phone's own SHA-1: expo-crypto's on a device, node's under test
export type Sha1 = (bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;

const encoder = new TextEncoder();

// git's blob id, so a row queued behind an unsent write names the blob that write will leave
export const blobOid = async (sha1: Sha1, bytes: Uint8Array): Promise<string> => {
  const header = encoder.encode(`blob ${String(bytes.length)}\0`);
  const framed = new Uint8Array(header.length + bytes.length);
  framed.set(header);
  framed.set(bytes, header.length);
  return hexFromBytes(await sha1(framed));
};

export const textBlobOid = async (sha1: Sha1, text: string): Promise<string> =>
  await blobOid(sha1, encoder.encode(text));

// the blob and text an unsent rename leaves at a path: the note at its new name, or a note whose
// links it rewrote; null where it leaves nothing
export const renameLeaves = async (
  sha1: Sha1,
  op: RenameOp,
  path: string,
): Promise<{ oid: string; content: string | null } | null> => {
  if (path === op.to) {
    return op.content === null
      ? { content: op.baseContent, oid: op.baseOid }
      : { content: op.content, oid: await textBlobOid(sha1, op.content) };
  }
  const rewrite = op.rewrites.find((candidate) => candidate.path === path);
  return rewrite === undefined
    ? null
    : { content: rewrite.content, oid: await textBlobOid(sha1, rewrite.content) };
};

const commentTextAt = (op: CommentOp, path: string): string | null => {
  if (path === op.store.path) {
    return op.store.content;
  }
  return op.anchored !== null && path === op.anchored.path ? op.anchored.content : null;
};

// the blob and text an unsent comment edit leaves at a path: its store, or the note it anchored in
export const commentLeaves = async (
  sha1: Sha1,
  op: CommentOp,
  path: string,
): Promise<{ oid: string; content: string } | null> => {
  const content = commentTextAt(op, path);
  return content === null ? null : { content, oid: await textBlobOid(sha1, content) };
};

// what an unsent rename or comment edit leaves at a path, which a write queued behind it is
// computed from
export const leavesAt = async (
  sha1: Sha1,
  op: RenameOp | CommentOp,
  path: string,
): Promise<{ oid: string; content: string | null } | null> =>
  op.op === "rename" ? await renameLeaves(sha1, op, path) : await commentLeaves(sha1, op, path);

// an edit computed from `base`, carried onto the text the path holds now; null where the two
// changed the same lines, which leaves that text as it is
export const rebaseEdit = (base: string, edited: string, current: string): string | null => {
  if (current === base) {
    return edited;
  }
  const { conflicted, merged } = diff3(base, edited, current);
  return conflicted ? null : merged;
};
