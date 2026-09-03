// GET /vault/asset is not a procedure: its body is bytes with an etag and if-none-match
// revalidation, which an rpc envelope cannot carry.

import { oc } from "@orpc/contract";
import { ALREADY_EXISTS, CAS_MISMATCH, INVALID_PATH } from "../local-errors";
import {
  vaultAssetWriteRequestSchema,
  vaultAssetWriteResponseSchema,
  vaultCommitResponseSchema,
  vaultDeletedResponseSchema,
  vaultDeleteRequestSchema,
  vaultDeleteResponseSchema,
  vaultHistoryRequestSchema,
  vaultHistoryResponseSchema,
  vaultMkdirRequestSchema,
  vaultMkdirResponseSchema,
  vaultReadRequestSchema,
  vaultReadResponseSchema,
  vaultRenameRequestSchema,
  vaultRenameResponseSchema,
  vaultRevisionRequestSchema,
  vaultRevisionResponseSchema,
  vaultStatusResponseSchema,
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

  // an unknown path answers an empty page, not NOT_FOUND: a note inside the auto-commit's quiet
  // window has no revisions yet.
  history: oc.input(vaultHistoryRequestSchema).output(vaultHistoryResponseSchema),

  // no vault.restore: restore is the client composing this with write + expectedHash (or
  // ifAbsent for a deleted note), so there is one cas.
  revision: oc
    .input(vaultRevisionRequestSchema)
    .output(vaultRevisionResponseSchema)
    .errors({ NOT_FOUND: {}, PAYLOAD_TOO_LARGE: {} }),

  // ALREADY_EXISTS is ifAbsent's refusal; every other collision answers CONFLICT, so no other
  // row declares it.
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
    .errors({ INVALID_PATH, NOT_FOUND: {}, CONFLICT: {} }),

  mkdir: oc
    .input(vaultMkdirRequestSchema)
    .output(vaultMkdirResponseSchema)
    .errors({ INVALID_PATH, CONFLICT: {} }),

  // the recovery surface: there is no trash folder, the git log is the record of what was deleted.
  deleted: oc.output(vaultDeletedResponseSchema),

  remove: oc
    .input(vaultDeleteRequestSchema)
    .output(vaultDeleteResponseSchema)
    .errors({ INVALID_PATH, NOT_FOUND: {} }),

  // a restore checkpoints first: the auto-commit is session-shaped, so the bytes being replaced
  // may be in no revision yet.
  commitNow: oc.output(vaultCommitResponseSchema),

  status: oc.output(vaultStatusResponseSchema),

  syncNow: oc.output(vaultStatusResponseSchema),
};
