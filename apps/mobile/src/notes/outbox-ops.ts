// what a row of the phone's outbox holds, parsed on every read: the user's intent, and once the
// vault has refused it as stale, the one change set that settles it. The intent is kept beside the
// settle because an edit made while the set is out is rebased onto what the set landed.

import { z } from "zod";
import { hexFromBytes } from "@repo/api/cloud/bytes";
import { vaultCommitRequestSchema } from "@repo/api/cloud/vault/vault-commit-schema";
import type { VaultChangeRequest } from "@repo/api/cloud/vault/vault-commit-schema";
import { gitOidSchema, vaultPathSchema } from "@repo/api/cloud/vault/vault-schema";
import type { SyncConflictReport } from "@repo/notes/sync/conflict-copy";

// `baseOid` / `baseContent` name the blob the write was computed from and its text: the vault
// takes the write only while the path still holds that blob, and a write refused as stale is
// merged against that text. A rename keeps the note's text where the phone holds it, since
// settling a rename onto a taken name merges the two notes.
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
    from: vaultPathSchema,
    op: z.literal("rename"),
    to: vaultPathSchema,
  }),
  z.object({ baseOid: gitOidSchema, op: z.literal("remove"), path: vaultPathSchema }),
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

export const opPaths = (op: VaultOp): readonly string[] =>
  op.op === "rename" ? [op.from, op.to] : [op.path];

export const isTextOp = (op: VaultOp): op is TextOp => op.op === "write" || op.op === "create";

export const putText = (path: string, base: string | null, text: string): VaultChangeRequest => ({
  base,
  content: { encoding: "utf-8", text },
  op: "put",
  path,
});

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
