// The connected-folders handlers. The service decides; this layer maps each
// refusal kind to the class its contract row declares, and a kind a row does
// not declare rethrows into the generic 500.

import { base } from "../orpc";
import { FolderRefusedError } from "./folders-service";

const list = base.folders.list.handler(({ context }) => ({ folders: context.folders.list() }));

const add = base.folders.add.handler(({ context, input, errors }) => {
  try {
    return { folders: context.folders.add(input.path) };
  } catch (error) {
    if (error instanceof FolderRefusedError) {
      switch (error.kind) {
        case "invalid-path":
          throw errors.INVALID_PATH({ message: error.message });
        case "already-exists":
          throw errors.ALREADY_EXISTS({ message: error.message });
        case "not-found":
          break;
      }
    }
    throw error;
  }
});

const remove = base.folders.remove.handler(({ context, input, errors }) => {
  try {
    return { folders: context.folders.remove(input.path) };
  } catch (error) {
    if (error instanceof FolderRefusedError && error.kind === "not-found") {
      throw errors.NOT_FOUND({ message: error.message });
    }
    throw error;
  }
});

export const foldersRouter = {
  list,
  add,
  remove,
};
