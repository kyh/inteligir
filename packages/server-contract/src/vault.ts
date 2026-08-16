// The vault wire contract: file CRUD over the vault directory plus the git
// sync surface. Paths are vault-relative POSIX strings; the server validates
// them (no traversal, no .git) and answers 400 for a path it refuses.

import type { EmptyInput } from "@repo/typed-routes/endpoint";
import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  noRequest,
  queryRequest,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
import type { ApiErrorResponse } from "./routes";

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
      size: z.number().int().min(0),
    })
    .strict(),
]);
export type VaultEntry = z.infer<typeof vaultEntrySchema>;

export const vaultTreeResponseSchema = z
  .object({
    /** Absolute path of the vault root on this machine. */
    root: z.string().min(1),
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
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const vaultReadRequestSchema = z.object({ path: z.string().min(1) }).strict();
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
    path: z.string().min(1),
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

/**
 * Every 409 a write can answer, one schema: `error` is the refusal class
 * (`cas_mismatch`, `already_exists`, or the service's plain `conflict`), and
 * `current` is present exactly for `cas_mismatch` on a file that still
 * exists — the content and hash a merging client needs to retry against.
 */
export const vaultWriteConflictSchema = z
  .object({
    error: z.string().min(1),
    message: z.string(),
    current: z
      .object({
        content: z.string(),
        hash: z.string().regex(/^[0-9a-f]{64}$/u),
      })
      .strict()
      .optional(),
  })
  .strict();
export type VaultWriteConflict = z.infer<typeof vaultWriteConflictSchema>;

export const vaultRenameRequestSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
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

export const vaultMkdirRequestSchema = z.object({ path: z.string().min(1) }).strict();
export type VaultMkdirRequest = z.infer<typeof vaultMkdirRequestSchema>;

export const vaultMkdirResponseSchema = z.object({ path: z.string().min(1) }).strict();
export type VaultMkdirResponse = z.infer<typeof vaultMkdirResponseSchema>;

export const vaultDeleteRequestSchema = z.object({ path: z.string().min(1) }).strict();
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

const syncFieldsShape = {
  /** Epoch ms of the last sync that pushed successfully. */
  lastSyncAt: z.number().int().nullable(),
  lastError: z.string().nullable(),
};

export const vaultStatusResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("no-remote"), ...syncFieldsShape }).strict(),
  /** A sync left rebase state behind that even `rebase --abort` could not
   *  clear; `lastError` names the manual recovery. The engine never syncs
   *  again while broken. */
  z
    .object({
      state: z.literal("broken"),
      remote: z.string().min(1),
      ...syncFieldsShape,
    })
    .strict(),
  z
    .object({
      state: z.literal("clean"),
      remote: z.string().min(1),
      ...syncFieldsShape,
    })
    .strict(),
  z
    .object({
      state: z.literal("dirty"),
      remote: z.string().min(1),
      ...syncFieldsShape,
    })
    .strict(),
  z
    .object({
      state: z.literal("syncing"),
      remote: z.string().min(1),
      ...syncFieldsShape,
    })
    .strict(),
  z
    .object({
      state: z.literal("conflict"),
      remote: z.string().min(1),
      conflict: vaultConflictSchema,
      ...syncFieldsShape,
    })
    .strict(),
]);
export type VaultStatusResponse = z.infer<typeof vaultStatusResponseSchema>;

export const vaultRoutes = {
  tree: defineRoute({
    path: "/vault/tree",
    method: "get",
    request: noRequest(),
    response: jsonResponse<VaultTreeResponse>(),
  }),
  read: defineRoute({
    path: "/vault/file",
    method: "get",
    request: queryRequest<EmptyInput, VaultReadRequest>(vaultReadRequestSchema),
    response: [
      jsonResponse<VaultReadResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
      jsonResponse<ApiErrorResponse, 413>({ status: 413 }),
    ],
  }),
  write: defineRoute({
    path: "/vault/file",
    method: "put",
    request: jsonRequest<EmptyInput, VaultWriteRequest>(vaultWriteRequestSchema),
    response: [
      jsonResponse<VaultWriteResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<VaultWriteConflict>({ status: 409 }),
    ],
  }),
  rename: defineRoute({
    path: "/vault/rename",
    method: "post",
    request: jsonRequest<EmptyInput, VaultRenameRequest>(vaultRenameRequestSchema),
    response: [
      jsonResponse<VaultRenameResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
    ],
  }),
  mkdir: defineRoute({
    path: "/vault/mkdir",
    method: "post",
    request: jsonRequest<EmptyInput, VaultMkdirRequest>(vaultMkdirRequestSchema),
    response: [
      jsonResponse<VaultMkdirResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
    ],
  }),
  remove: defineRoute({
    path: "/vault/delete",
    method: "post",
    request: jsonRequest<EmptyInput, VaultDeleteRequest>(vaultDeleteRequestSchema),
    response: [
      jsonResponse<VaultDeleteResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
    ],
  }),
  status: defineRoute({
    path: "/vault/status",
    method: "get",
    request: noRequest(),
    response: jsonResponse<VaultStatusResponse>(),
  }),
  syncNow: defineRoute({
    path: "/vault/sync",
    method: "post",
    request: noRequest(),
    response: jsonResponse<VaultStatusResponse>(),
  }),
};
