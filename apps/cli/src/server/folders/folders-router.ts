// The connected-folders handlers. The service decides; this layer maps each
// refusal code to the class its contract row declares. Each switch covers only
// its own operation's codes and has no default, so a code added without a class
// fails to compile.

import { base } from "../orpc";
import { FolderRefusedError } from "./folders-service";

const list = base.folders.list.handler(({ context }) => ({ folders: context.folders.list() }));

const add = base.folders.add.handler(({ context, input, errors }) => {
  try {
    return { folders: context.folders.add(input.path) };
  } catch (error) {
    if (!(error instanceof FolderRefusedError) || error.refusal.op !== "add") {
      throw error;
    }
    const { message } = error;
    switch (error.refusal.code) {
      case "invalid_path": {
        throw errors.INVALID_PATH({ message });
      }
      case "already_exists": {
        throw errors.ALREADY_EXISTS({ message });
      }
      case "limit_reached": {
        throw errors.LIMIT_REACHED({ message });
      }
      // no default
    }
  }
});

const remove = base.folders.remove.handler(({ context, input, errors }) => {
  try {
    return { folders: context.folders.remove(input.path) };
  } catch (error) {
    if (!(error instanceof FolderRefusedError) || error.refusal.op !== "remove") {
      throw error;
    }
    const { message } = error;
    switch (error.refusal.code) {
      case "not_found": {
        throw errors.NOT_FOUND({ message });
      }
      // no default
    }
  }
});

export const foldersRouter = {
  add,
  list,
  remove,
};
