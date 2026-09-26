import { z } from "zod";
import { cloudErrorSchema } from "../cloud-errors";
import { gitOidSchema, vaultPathSchema } from "./vault-schema";

// A change set lands as one commit or none. Each change names the blob it was computed from (null:
// the path must be absent), so the hosted head is a CAS per path, and a change whose target the
// head already holds is satisfied: a resent set answers the commit that holds it and writes nothing.

// a rename rewrites the link in every note that names it, and that whole rewrite is one set
export const VAULT_COMMIT_MAX_CHANGES = 100;

// the declared body, parsed whole in memory: one attachment at its ceiling, base64'd, fits beside
// the note that embeds it
export const VAULT_COMMIT_MAX_BYTES = 16 * 1024 * 1024;

// a text note crosses as the string it is; only an attachment path takes base64
const vaultContentSchema = z.discriminatedUnion("encoding", [
  z.object({ encoding: z.literal("utf-8"), text: z.string() }).strict(),
  z.object({ data: z.base64(), encoding: z.literal("base64") }).strict(),
]);

const vaultChangeSchema = z.discriminatedUnion("op", [
  z
    .object({
      base: gitOidSchema.nullable(),
      content: vaultContentSchema,
      op: z.literal("put"),
      path: vaultPathSchema,
    })
    .strict(),
  z.object({ base: gitOidSchema, op: z.literal("delete"), path: vaultPathSchema }).strict(),
  z
    .object({
      base: gitOidSchema,
      from: vaultPathSchema,
      op: z.literal("move"),
      to: vaultPathSchema,
    })
    .strict(),
]);
export type VaultChangeRequest = z.infer<typeof vaultChangeSchema>;

export const vaultChangePaths = (change: VaultChangeRequest): readonly string[] =>
  change.op === "move" ? [change.from, change.to] : [change.path];

export const vaultCommitRequestSchema = z
  .object({
    // unix ms, when the device made the change: a queued edit keeps its own time in the history
    authoredAt: z.number().int().nonnegative().optional(),
    changes: z
      .array(vaultChangeSchema)
      .min(1)
      .max(VAULT_COMMIT_MAX_CHANGES)
      .refine((changes) => {
        const named = changes.flatMap(vaultChangePaths);
        return new Set(named).size === named.length;
      }, "a change set names each path once"),
  })
  .strict();
export type VaultCommitRequest = z.infer<typeof vaultCommitRequestSchema>;

// where each change leaves its path: the blob it holds, or null once it is gone
export const vaultCommitResponseSchema = z.object({
  commit: gitOidSchema,
  results: z.array(z.object({ oid: gitOidSchema.nullable(), path: vaultPathSchema })),
});
export type VaultCommitResponse = z.infer<typeof vaultCommitResponseSchema>;

const VAULT_CONFLICT_REASONS = [
  "changed",
  "exists",
  "missing",
  "blocked",
  "case-collision",
  "unwritable",
] as const;
export type VaultConflictReason = (typeof VAULT_CONFLICT_REASONS)[number];

// a reason this build does not know is a newer Worker's; no merge is known to settle it, so it
// reads as a path this build cannot write, which parks the change rather than refusing the answer
const vaultConflictReasonSchema = z
  .string()
  .transform(
    (reason): VaultConflictReason =>
      VAULT_CONFLICT_REASONS.find((known) => known === reason) ?? "unwritable",
  );

const vaultConflictSchema = z.object({
  // what the path holds at the conflict's head; its text rides along only for a note that fits
  current: z.object({ content: z.string().optional(), oid: gitOidSchema }).nullable(),
  // the device whose commit last touched the path
  device: z.string().nullable(),
  path: vaultPathSchema,
  reason: vaultConflictReasonSchema,
});

const vaultCommitConflictSchema = z.object({
  conflicts: z.array(vaultConflictSchema).min(1),
  head: gitOidSchema,
});
export type VaultCommitConflict = z.infer<typeof vaultCommitConflictSchema>;

// the 409 is the ordinary envelope with the conflict beside it, so a reader that knows only the
// envelope still reads a refusal it can name
export const vaultConflictAnswerSchema = cloudErrorSchema.extend({
  conflict: vaultCommitConflictSchema,
});
export type VaultConflictAnswer = z.infer<typeof vaultConflictAnswerSchema>;

// a Mac's filesystem is case- and normalization-insensitive: two paths that agree here are one file
// there
export const vaultCollisionKey = (path: string): string => path.normalize("NFC").toLowerCase();
