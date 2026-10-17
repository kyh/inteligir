// saving and filling items. a page that cannot be reached or is refused is no error: the item is
// kept, and its fill says why.

import { oc } from "@orpc/contract";
import { INVALID_PATH } from "../local-errors";
import {
  itemSaveResponseSchema,
  itemsRefreshRequestSchema,
  itemsRefreshResponseSchema,
  itemsSaveFileRequestSchema,
  itemsSaveLinkRequestSchema,
  itemsSavePageRequestSchema,
  itemsTagRequestSchema,
  itemsTagResponseSchema,
} from "./items-schema";

export const itemsContract = {
  // CONFLICT: a file stands where the folder must be, or the name kept being taken
  saveLink: oc
    .input(itemsSaveLinkRequestSchema)
    .output(itemSaveResponseSchema)
    .errors({ CONFLICT: {}, INVALID_PATH }),

  savePage: oc
    .input(itemsSavePageRequestSchema)
    .output(itemSaveResponseSchema)
    .errors({ CONFLICT: {}, INVALID_PATH }),

  // PAYLOAD_TOO_LARGE carries fileTooLargeMessage's sentence; INVALID_PATH: the name is a doc's or
  // a metadata name ("a note is saved as text, not as a file"); CONFLICT: a file stands where the
  // folder must be
  saveFile: oc
    .input(itemsSaveFileRequestSchema)
    .output(itemSaveResponseSchema)
    .errors({ CONFLICT: {}, INVALID_PATH, PAYLOAD_TOO_LARGE: {} }),

  // NOT_FOUND: no such item. BAD_REQUEST: not a url item ("Only a saved link can be refreshed.").
  // CONFLICT: text "replace" on a body with highlights ("Its highlights would be lost; remove
  // them first.")
  refresh: oc
    .input(itemsRefreshRequestSchema)
    .output(itemsRefreshResponseSchema)
    .errors({ BAD_REQUEST: {}, CONFLICT: {}, NOT_FOUND: {} }),

  // a path it cannot tag answers in its own result, so one bad path never fails the rest
  tag: oc.input(itemsTagRequestSchema).output(itemsTagResponseSchema),
};
