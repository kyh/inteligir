import { oc } from "@orpc/contract";
import { ALREADY_EXISTS, INVALID_PATH } from "../local-errors";
import {
  connectedFolderAddRequestSchema,
  connectedFolderRemoveRequestSchema,
  connectedFoldersResponseSchema,
} from "./folders-schema";

export const foldersContract = {
  list: oc.output(connectedFoldersResponseSchema),

  // INVALID_PATH also covers the list's size bound
  add: oc
    .input(connectedFolderAddRequestSchema)
    .output(connectedFoldersResponseSchema)
    .errors({ INVALID_PATH, ALREADY_EXISTS }),

  // removal matches the stored spelling, so an unresolvable row is still removable
  remove: oc
    .input(connectedFolderRemoveRequestSchema)
    .output(connectedFoldersResponseSchema)
    .errors({ NOT_FOUND: {} }),
};
