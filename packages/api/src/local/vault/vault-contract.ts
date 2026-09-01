// The vault's procedures. One row per operation, each naming its input, its
// output and the classes it can refuse with. There is no path and no method:
// the RPC transport addresses a procedure by its position in the router.
//
// `GET /vault/asset` is deliberately NOT here. Its body is BYTES with an ETag
// and a sandbox CSP, revalidated with `if-none-match`, and none of that
// survives an RPC envelope — it stays a plain HTTP route beside /ws.

import { oc } from "@orpc/contract";
import { ALREADY_EXISTS, CAS_MISMATCH, INVALID_PATH } from "../local-errors";
import {
  vaultAssetWriteRequestSchema,
  vaultAssetWriteResponseSchema,
  vaultCommitResponseSchema,
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

  /** The note's own commits, newest first, across renames. A path git has
   *  never seen answers an EMPTY page rather than refusing: a note created
   *  inside the auto-commit's quiet window has no revisions yet, and that is
   *  an ordinary state the surface renders. */
  history: oc.input(vaultHistoryRequestSchema).output(vaultHistoryResponseSchema),

  /** The bytes a note held at one revision. Restore is the CLIENT composing
   *  this with `write` + `expectedHash` — there is deliberately no
   *  `vault.restore`, which would be a second write path with its own CAS,
   *  its own notification and its own chance to disagree with the first. */
  revision: oc
    .input(vaultRevisionRequestSchema)
    .output(vaultRevisionResponseSchema)
    .errors({ NOT_FOUND: {}, PAYLOAD_TOO_LARGE: {} }),

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

  /** Checkpoint the vault now: commit whatever is dirty, as the engine.
   *  What a restore calls before it overwrites the note — the auto-commit is
   *  session-shaped, so bytes a user saved seconds ago are still uncommitted,
   *  and overwriting them would leave them in no revision at all. */
  commitNow: oc.output(vaultCommitResponseSchema),

  status: oc.output(vaultStatusResponseSchema),

  /** Runs a sync pass now and answers the state it left behind. Takes no
   *  input; a caller that wants to know without acting reads `status`. */
  syncNow: oc.output(vaultStatusResponseSchema),
};
