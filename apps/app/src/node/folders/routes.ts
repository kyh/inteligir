// The connected-folders routes, registered against the contract rows. The
// service decides; this layer maps each refusal class to its declared status,
// and a class a route does not declare rethrows into the generic 500.

import { folderRoutes } from "@repo/server-contract/folders";
import { API_ERROR_STATUS } from "@repo/server-contract/errors";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import { FolderRefusedError, type FoldersService } from "./folders-service";

function refusalFor(cause: unknown): FolderRefusedError | null {
  return cause instanceof FolderRefusedError ? cause : null;
}

export function registerFolderRoutes(
  registrars: Pick<TypedRoutesRegistrars, "get" | "post">,
  service: FoldersService,
): void {
  const { get, post } = registrars;

  get(folderRoutes.list, (c) => c.json({ folders: service.list() }));

  post(folderRoutes.add, (c, body) => {
    try {
      return c.json({ folders: service.add(body.path) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "invalid-path":
          return c.json(
            { error: "invalid_request", message: refusal.message },
            API_ERROR_STATUS.invalid_request,
          );
        case "already-exists":
          return c.json(
            { error: "already_exists", message: refusal.message },
            API_ERROR_STATUS.already_exists,
          );
        case "not-found":
        case undefined:
          throw error;
      }
    }
  });

  post(folderRoutes.remove, (c, body) => {
    try {
      return c.json({ folders: service.remove(body.path) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "not-found":
          return c.json(
            { error: "not_found", message: refusal.message },
            API_ERROR_STATUS.not_found,
          );
        case "invalid-path":
          return c.json(
            { error: "invalid_request", message: refusal.message },
            API_ERROR_STATUS.invalid_request,
          );
        case "already-exists":
        case undefined:
          throw error;
      }
    }
  });
}
