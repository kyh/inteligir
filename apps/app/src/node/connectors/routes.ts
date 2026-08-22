// The connector routes, registered against the contract rows. The service
// decides; this layer only says which refusal class each throw answers with.
// Each write switches EXHAUSTIVELY over the refusal set — including the class
// its own row does not declare, which rethrows into the API's generic 500, so
// a new class arriving is decided per route rather than defaulted.

import { connectorRoutes } from "@repo/server-contract/connectors";
import { API_ERROR_STATUS } from "@repo/server-contract/errors";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import { ConnectorConflictError, type ConnectorsService } from "./connectors-service";

function refusalFor(cause: unknown): ConnectorConflictError | null {
  return cause instanceof ConnectorConflictError ? cause : null;
}

export function registerConnectorRoutes(
  registrars: Pick<TypedRoutesRegistrars, "get" | "post">,
  service: ConnectorsService,
): void {
  const { get, post } = registrars;

  get(connectorRoutes.list, (c) => c.json({ servers: service.list() }));

  post(connectorRoutes.add, (c, body) => {
    try {
      return c.json({ servers: service.add(body) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
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

  post(connectorRoutes.update, (c, body) => {
    try {
      return c.json({ servers: service.update(body) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "not-found":
          return c.json(
            { error: "not_found", message: refusal.message },
            API_ERROR_STATUS.not_found,
          );
        case "already-exists":
        case undefined:
          throw error;
      }
    }
  });

  post(connectorRoutes.remove, (c, body) => {
    try {
      return c.json({ servers: service.remove(body.name) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "not-found":
          return c.json(
            { error: "not_found", message: refusal.message },
            API_ERROR_STATUS.not_found,
          );
        case "already-exists":
        case undefined:
          throw error;
      }
    }
  });

  post(connectorRoutes.toggle, (c, body) => {
    try {
      return c.json({ servers: service.toggle(body.name, body.enabled) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "not-found":
          return c.json(
            { error: "not_found", message: refusal.message },
            API_ERROR_STATUS.not_found,
          );
        case "already-exists":
        case undefined:
          throw error;
      }
    }
  });
}
