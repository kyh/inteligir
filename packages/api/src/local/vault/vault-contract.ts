// GET /vault/asset is not a procedure: its body is bytes with an etag and if-none-match
// revalidation, which an rpc envelope cannot carry.

import { oc } from "@orpc/contract";
import { ALREADY_EXISTS, CAS_MISMATCH, INVALID_PATH } from "../local-errors";
import {
  vaultAssetWriteRequestSchema,
  vaultAssetWriteResponseSchema,
  vaultCommitRequestSchema,
  vaultCommitResponseSchema,
  vaultDeletedResponseSchema,
  vaultDeleteRequestSchema,
  vaultDeleteResponseSchema,
  vaultHistoryRequestSchema,
  vaultHistoryResponseSchema,
  vaultMkdirRequestSchema,
  vaultMkdirResponseSchema,
  vaultPrefsResponseSchema,
  vaultSetPrefsRequestSchema,
  vaultSetRemoteRequestSchema,
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
  // CONFLICT: a file stands where the attachments folder must be.
  assetWrite: oc
    .input(vaultAssetWriteRequestSchema)
    .output(vaultAssetWriteResponseSchema)
    .errors({ CONFLICT: {}, INVALID_PATH, PAYLOAD_TOO_LARGE: {} }),

  // a restore checkpoints first: the auto-commit is session-shaped, so the bytes being replaced
  // may be in no revision yet.
  commitNow: oc.input(vaultCommitRequestSchema).output(vaultCommitResponseSchema),

  // the recovery surface: there is no trash folder, the git log is the record of what was deleted.
  deleted: oc.output(vaultDeletedResponseSchema),

  // an unknown path answers an empty page, not NOT_FOUND: a note inside the auto-commit's quiet
  // window has no revisions yet.
  history: oc.input(vaultHistoryRequestSchema).output(vaultHistoryResponseSchema),

  mkdir: oc
    .input(vaultMkdirRequestSchema)
    .output(vaultMkdirResponseSchema)
    .errors({ CONFLICT: {}, INVALID_PATH }),

  // the vault's own choices, stored beside the data dir's other app-written files; the
  // attachments folder need not exist, it is created on the first paste.
  prefs: oc.output(vaultPrefsResponseSchema),

  read: oc
    .input(vaultReadRequestSchema)
    .output(vaultReadResponseSchema)
    .errors({ INVALID_PATH, NOT_FOUND: {}, PAYLOAD_TOO_LARGE: {} }),

  remove: oc
    .input(vaultDeleteRequestSchema)
    .output(vaultDeleteResponseSchema)
    .errors({ INVALID_PATH, NOT_FOUND: {} }),

  rename: oc
    .input(vaultRenameRequestSchema)
    .output(vaultRenameResponseSchema)
    .errors({ CONFLICT: {}, INVALID_PATH, NOT_FOUND: {} }),

  // no vault.restore: restore is the client composing this with an `expected`-guarded write (or
  // an `absent` one for a deleted note), so there is one cas.
  revision: oc
    .input(vaultRevisionRequestSchema)
    .output(vaultRevisionResponseSchema)
    .errors({ NOT_FOUND: {}, PAYLOAD_TOO_LARGE: {} }),

  // edits the vault's own origin, the one record a pass reads, and answers the status the choice
  // leaves; the new remote's first pass is kicked, not awaited. CONFLICT: INTELIGIR_VAULT_REMOTE
  // pins the remote, and only its environment changes it. a url the grammar refuses is the input's
  // BAD_REQUEST.
  setRemote: oc
    .input(vaultSetRemoteRequestSchema)
    .output(vaultStatusResponseSchema)
    .errors({ CONFLICT: {} }),

  // INVALID_PATH: the named attachments folder is a file today, which would refuse every paste
  setPrefs: oc
    .input(vaultSetPrefsRequestSchema)
    .output(vaultPrefsResponseSchema)
    .errors({ INVALID_PATH }),

  status: oc.output(vaultStatusResponseSchema),

  syncNow: oc.output(vaultStatusResponseSchema),

  tree: oc.output(vaultTreeResponseSchema),

  // ALREADY_EXISTS is the `absent` guard's refusal; every other collision answers CONFLICT, so no
  // other row declares it.
  write: oc
    .input(vaultWriteRequestSchema)
    .output(vaultWriteResponseSchema)
    .errors({ ALREADY_EXISTS, CAS_MISMATCH, CONFLICT: {}, INVALID_PATH }),
};
