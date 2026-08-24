// The vault's procedures. One row per operation, each naming its input, its
// output and the classes it can refuse with — the same three claims the route
// table made, minus a path and a method, because the RPC transport addresses a
// procedure by its position in the router.
//
// `GET /vault/asset` is deliberately NOT here. Its body is BYTES with an ETag
// and a sandbox CSP, revalidated with `if-none-match`, and none of that
// survives an RPC envelope — it stays a plain HTTP route beside /ws.

import { oc } from "@orpc/contract";
import { ALREADY_EXISTS, CAS_MISMATCH, INVALID_PATH } from "../local-errors";
import {
  vaultAssetWriteRequestSchema,
  vaultAssetWriteResponseSchema,
  vaultDeleteRequestSchema,
  vaultDeleteResponseSchema,
  vaultMkdirRequestSchema,
  vaultMkdirResponseSchema,
  vaultReadRequestSchema,
  vaultReadResponseSchema,
  vaultRenameRequestSchema,
  vaultRenameResponseSchema,
  vaultStatusResponseSchema,
  vaultTrashListResponseSchema,
  vaultTrashMoveResponseSchema,
  vaultTrashRequestSchema,
  vaultTreeResponseSchema,
  vaultWriteRequestSchema,
  vaultWriteResponseSchema,
} from "./vault-schema";

export const vaultContract = {
  tree: oc.output(vaultTreeResponseSchema),

  read: oc
    .input(vaultReadRequestSchema)
    .output(vaultReadResponseSchema)
    .errors({ INVALID_PATH, NOT_FOUND: {}, PAYLOAD_TOO_LARGE: {} }),

  write: oc
    .input(vaultWriteRequestSchema)
    .output(vaultWriteResponseSchema)
    .errors({ INVALID_PATH, ALREADY_EXISTS, CAS_MISMATCH, CONFLICT: {} }),

  assetWrite: oc
    .input(vaultAssetWriteRequestSchema)
    .output(vaultAssetWriteResponseSchema)
    .errors({ INVALID_PATH, PAYLOAD_TOO_LARGE: {} }),

  rename: oc
    .input(vaultRenameRequestSchema)
    .output(vaultRenameResponseSchema)
    .errors({ INVALID_PATH, ALREADY_EXISTS, NOT_FOUND: {}, CONFLICT: {} }),

  mkdir: oc
    .input(vaultMkdirRequestSchema)
    .output(vaultMkdirResponseSchema)
    .errors({ INVALID_PATH, ALREADY_EXISTS, CONFLICT: {} }),

  trashList: oc.output(vaultTrashListResponseSchema),

  trash: oc
    .input(vaultTrashRequestSchema)
    .output(vaultTrashMoveResponseSchema)
    .errors({ INVALID_PATH, ALREADY_EXISTS, NOT_FOUND: {}, CONFLICT: {} }),

  trashRestore: oc
    .input(vaultTrashRequestSchema)
    .output(vaultTrashMoveResponseSchema)
    .errors({ INVALID_PATH, ALREADY_EXISTS, NOT_FOUND: {}, CONFLICT: {} }),

  trashPurge: oc
    .input(vaultTrashRequestSchema)
    .output(vaultDeleteResponseSchema)
    .errors({ INVALID_PATH, NOT_FOUND: {} }),

  remove: oc
    .input(vaultDeleteRequestSchema)
    .output(vaultDeleteResponseSchema)
    .errors({ INVALID_PATH, NOT_FOUND: {} }),

  status: oc.output(vaultStatusResponseSchema),

  /** Runs a sync pass now and answers the state it left behind. Takes no
   *  input; a caller that wants to know without acting reads `status`. */
  syncNow: oc.output(vaultStatusResponseSchema),
};
