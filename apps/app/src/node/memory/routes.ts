// The memory routes, registered against the contract rows. Human-facing only:
// `list` reads the directory (valid facts and the files that were not), and
// `remove` deletes one by filename and answers the fresh listing — the same
// shape `list` does, so the settings surface's next render is the server's own
// view of the directory. There is no add route: the agent remembers by writing
// a file with its shell (issue #575).

import { API_ERROR_STATUS, type ApiErrorResponse } from "@repo/server-contract/errors";
import { memoryRoutes } from "@repo/server-contract/memory";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import {
  deleteMemoryFile,
  InvalidMemoryFileError,
  MemoryFileNotFoundError,
  scanMemoryDir,
} from "./memory-store";

export function registerMemoryRoutes(
  registrars: Pick<TypedRoutesRegistrars, "get" | "post">,
  memoryDir: string,
): void {
  const { get, post } = registrars;

  get(memoryRoutes.list, (c) => c.json(scanMemoryDir(memoryDir)));

  post(memoryRoutes.remove, (c, body) => {
    try {
      deleteMemoryFile(memoryDir, body.file);
      return c.json(scanMemoryDir(memoryDir));
    } catch (error) {
      if (error instanceof InvalidMemoryFileError) {
        const refusal: ApiErrorResponse = { error: "invalid_request", message: error.message };
        return c.json(refusal, API_ERROR_STATUS.invalid_request);
      }
      if (error instanceof MemoryFileNotFoundError) {
        const refusal: ApiErrorResponse = { error: "not_found", message: error.message };
        return c.json(refusal, API_ERROR_STATUS.not_found);
      }
      throw error;
    }
  });
}
