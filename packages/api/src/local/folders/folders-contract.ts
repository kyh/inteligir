// The connected-folders procedures. Each mutation answers the WHOLE list, so a
// client never has to reconstruct the store's state from a delta it applied
// locally.

import { oc } from "@orpc/contract";
import { ALREADY_EXISTS, INVALID_PATH } from "../local-errors";
import {
  connectedFolderAddRequestSchema,
  connectedFolderRemoveRequestSchema,
  connectedFoldersResponseSchema,
} from "./folders-schema";

export const foldersContract = {
  list: oc.output(connectedFoldersResponseSchema),

  /** INVALID_PATH covers every judgement the server makes about the path once
   *  it parsed — not absolute, not a directory, gone, inside the vault,
   *  containing the data dir — and the list's own size bound. */
  add: oc
    .input(connectedFolderAddRequestSchema)
    .output(connectedFoldersResponseSchema)
    .errors({ INVALID_PATH, ALREADY_EXISTS }),

  /** Removal matches the stored spelling, so an unresolvable row is still
   *  removable and there is no path judgement left to refuse with. */
  remove: oc
    .input(connectedFolderRemoveRequestSchema)
    .output(connectedFoldersResponseSchema)
    .errors({ NOT_FOUND: {} }),
};
