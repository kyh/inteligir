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
    content: z.string(),
  })
  .strict();
export type VaultWriteRequest = z.infer<typeof vaultWriteRequestSchema>;

export const vaultWriteResponseSchema = z.object({ path: z.string().min(1) }).strict();
export type VaultWriteResponse = z.infer<typeof vaultWriteResponseSchema>;

export const vaultRenameRequestSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();
export type VaultRenameRequest = z.infer<typeof vaultRenameRequestSchema>;

export const vaultRenameResponseSchema = z.object({ path: z.string().min(1) }).strict();
export type VaultRenameResponse = z.infer<typeof vaultRenameResponseSchema>;

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
    ],
  }),
  write: defineRoute({
    path: "/vault/file",
    method: "put",
    request: jsonRequest<EmptyInput, VaultWriteRequest>(vaultWriteRequestSchema),
    response: [
      jsonResponse<VaultWriteResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
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
