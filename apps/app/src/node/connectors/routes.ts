// The connector routes, registered against the contract rows. The service
// decides; this layer only says which refusal class each of its throws answers
// with.
//
// Both writes switch EXHAUSTIVELY over the refusal set — including the class
// their own row does not declare, which rethrows into the API's generic 500.
// That is the point: `add` can never refuse "no such connector" and `remove`
// can never refuse "already configured", and a fourth class arriving is a
// compile error at both, which is where "what does THIS route answer for it"
// has to be decided.

import { connectorRoutes } from "@repo/server-contract/connectors";
import { API_ERROR_STATUS, type ApiErrorResponse } from "@repo/server-contract/errors";
import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import { CodexMcpError } from "./codex-mcp";
import {
  ConnectorConflictError,
  ConnectorsUnavailableError,
  type ConnectorsService,
} from "./connectors-service";

/**
 * Why a write refused, or null when the error is not one this layer owns.
 * `CodexMcpError` folds into `unavailable` alongside a missing binary
 * deliberately: from the caller's side "codex is not installed" and "codex
 * refused to run" are the same unusable capability, and the message is what
 * tells them apart.
 */
type WriteRefusal =
  | { kind: "already-exists"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "unavailable"; message: string };

function refusalFor(error: unknown): WriteRefusal | null {
  if (error instanceof ConnectorConflictError) {
    return { kind: error.kind, message: error.message };
  }
  if (error instanceof ConnectorsUnavailableError || error instanceof CodexMcpError) {
    return { kind: "unavailable", message: error.message };
  }
  return null;
}

function unavailableBody(message: string): ApiErrorResponse {
  return { error: "provider_unavailable", message };
}

export function registerConnectorRoutes(
  registrars: Pick<TypedRoutesRegistrars, "get" | "post">,
  service: ConnectorsService,
): void {
  const { get, post } = registrars;

  get(connectorRoutes.list, async (c) => c.json(await service.list()));

  post(connectorRoutes.add, async (c, body) => {
    try {
      return c.json({ servers: await service.add(body) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "already-exists":
          return c.json(
            { error: "already_exists", message: refusal.message },
            API_ERROR_STATUS.already_exists,
          );
        case "unavailable":
          return c.json(unavailableBody(refusal.message), API_ERROR_STATUS.provider_unavailable);
        case "not-found":
        case undefined:
          throw error;
      }
    }
  });

  post(connectorRoutes.remove, async (c, body) => {
    try {
      return c.json({ servers: await service.remove(body.name) });
    } catch (error) {
      const refusal = refusalFor(error);
      switch (refusal?.kind) {
        case "not-found":
          return c.json(
            { error: "not_found", message: refusal.message },
            API_ERROR_STATUS.not_found,
          );
        case "unavailable":
          return c.json(unavailableBody(refusal.message), API_ERROR_STATUS.provider_unavailable);
        case "already-exists":
        case undefined:
          throw error;
      }
    }
  });
}
