import { oc } from "@orpc/contract";
import { ALREADY_EXISTS, INVALID_PATH, LIMIT_REACHED } from "../local-errors";
import {
  connectedFolderAddRequestSchema,
  connectedFolderRemoveRequestSchema,
  connectedFoldersResponseSchema,
} from "./folders-schema";

export const foldersContract = {
  add: oc
    .input(connectedFolderAddRequestSchema)
    .output(connectedFoldersResponseSchema)
    .errors({ ALREADY_EXISTS, INVALID_PATH, LIMIT_REACHED }),

  list: oc.output(connectedFoldersResponseSchema),

  // removal matches the stored spelling, so an unresolvable row is still removable
  remove: oc
    .input(connectedFolderRemoveRequestSchema)
    .output(connectedFoldersResponseSchema)
    .errors({ NOT_FOUND: {} }),
};
